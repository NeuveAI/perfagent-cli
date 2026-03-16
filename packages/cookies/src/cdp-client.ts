import { spawn } from "node:child_process";
import path from "node:path";
import { Effect, Layer, Schedule, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import WebSocket from "ws";
import { formatError } from "@browser-tester/utils";
import { configByDisplayName } from "./browser-config.js";
import { BrowserSpawnError, CdpConnectionError } from "./errors.js";

const CDP_RETRY_COUNT = 10;
const CDP_COMMAND_TIMEOUT_MS = 10_000;
const CDP_LOCAL_PORT = 9222;
const HEADLESS_CHROME_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-address=127.0.0.1",
] as const;
import { stripLeadingDot } from "./utils/host-matching.js";
import { normalizeSameSite } from "./utils/normalize.js";
import type { BrowserProfile, Cookie, ExtractProfileOptions } from "./types.js";

const copyDirectoryRecursive = (
  fileSystem: FileSystem.FileSystem,
  source: string,
  target: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* fileSystem.makeDirectory(target, { recursive: true });
    const entries = yield* fileSystem.readDirectory(source);
    yield* Effect.forEach(entries, (entry) => {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      return fileSystem
        .stat(sourcePath)
        .pipe(
          Effect.flatMap((stat) =>
            stat.type === "Directory"
              ? copyDirectoryRecursive(fileSystem, sourcePath, targetPath)
              : fileSystem.copyFile(sourcePath, targetPath),
          ),
        );
    });
  });

interface CdpTarget {
  type: string;
  webSocketDebuggerUrl?: string;
}

interface CdpRawCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
}

interface CdpResponse {
  id: number;
  error?: { code: number; message: string };
  result?: { cookies: CdpRawCookie[] };
}

interface CdpCommand {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

const getPageWebSocketUrl = Effect.fn("CdpClient.getPageWebSocketUrl")(function* (port: number) {
  const listUrl = `http://localhost:${port}/json`;
  const response = yield* Effect.tryPromise({
    try: () => fetch(listUrl),
    catch: (cause) => new CdpConnectionError({ port, cause: formatError(cause) }),
  });
  const targets = yield* Effect.tryPromise({
    try: () => response.json() as Promise<CdpTarget[]>,
    catch: (cause) => new CdpConnectionError({ port, cause: formatError(cause) }),
  });
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) {
    return yield* new CdpConnectionError({ port, cause: "no page target available" }).asEffect();
  }
  return pageTarget.webSocketDebuggerUrl;
});

const sendCdpCommand = Effect.fn("CdpClient.sendCdpCommand")(function* (
  webSocketUrl: string,
  command: CdpCommand,
  port: number,
) {
  return yield* Effect.callback<CdpResponse, CdpConnectionError>((resume) => {
    const socket = new WebSocket(webSocketUrl);

    const timeoutId = setTimeout(() => {
      socket.close();
      resume(Effect.fail(new CdpConnectionError({ port, cause: "CDP command timed out" })));
    }, CDP_COMMAND_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.close();
    };

    socket.on("open", () => {
      socket.send(JSON.stringify(command));
    });

    socket.on("message", (rawMessage: WebSocket.Data) => {
      try {
        const parsedResponse = JSON.parse(rawMessage.toString()) as CdpResponse;
        if (parsedResponse.id !== command.id) return;
        cleanup();
        resume(Effect.succeed(parsedResponse));
      } catch (error) {
        cleanup();
        resume(
          Effect.fail(
            new CdpConnectionError({ port, cause: `failed to parse: ${formatError(error)}` }),
          ),
        );
      }
    });

    socket.on("error", (error: Error) => {
      cleanup();
      resume(Effect.fail(new CdpConnectionError({ port, cause: error.message })));
    });

    return Effect.sync(() => {
      clearTimeout(timeoutId);
      socket.close();
    });
  });
});

const toProfileCookie = (rawCookie: CdpRawCookie, profile: BrowserProfile): Cookie => ({
  name: rawCookie.name,
  value: rawCookie.value,
  domain: stripLeadingDot(rawCookie.domain),
  path: rawCookie.path,
  expires: rawCookie.expires > 0 ? Math.floor(rawCookie.expires) : undefined,
  secure: rawCookie.secure,
  httpOnly: rawCookie.httpOnly,
  sameSite: normalizeSameSite(rawCookie.sameSite),
  browser: configByDisplayName(profile.browser.name)?.key ?? "chrome",
});

export class CdpClient extends ServiceMap.Service<CdpClient>()("@cookies/CdpClient", {
  make: Effect.gen(function* () {
    const extractFromProfile = Effect.fn("CdpClient.extractFromProfile")(function* (
      options: ExtractProfileOptions,
    ) {
      const { profile } = options;
      const port = options.port ?? CDP_LOCAL_PORT;
      yield* Effect.annotateCurrentSpan({
        profileName: profile.profileName,
        browser: profile.browser.name,
      });

      const fileSystem = yield* FileSystem.FileSystem;

      const tempUserDataDirPath = yield* fileSystem.makeTempDirectory({ prefix: "cookies-cdp-" });
      yield* Effect.addFinalizer(() =>
        fileSystem
          .remove(tempUserDataDirPath, { recursive: true })
          .pipe(Effect.catch(() => Effect.void)),
      );

      const profileDirectoryName = path.basename(profile.profilePath);
      const tempProfilePath = path.join(tempUserDataDirPath, profileDirectoryName);

      yield* copyDirectoryRecursive(fileSystem, profile.profilePath, tempProfilePath).pipe(
        Effect.catch((cause) =>
          new BrowserSpawnError({
            executablePath: profile.browser.executablePath,
            cause: `Failed to copy profile: ${String(cause)}`,
          }).asEffect(),
        ),
      );

      const localStatePath = path.join(path.dirname(profile.profilePath), "Local State");
      if (yield* fileSystem.exists(localStatePath)) {
        yield* fileSystem
          .copyFile(localStatePath, path.join(tempUserDataDirPath, "Local State"))
          .pipe(Effect.catch(() => Effect.void));
      }

      // HACK: ChildProcessSpawner doesn't support detached+unref for headless browser lifecycle
      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const browserProcess = spawn(
              profile.browser.executablePath,
              [
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${tempUserDataDirPath}`,
                `--profile-directory=${profileDirectoryName}`,
                ...HEADLESS_CHROME_ARGS,
              ],
              { stdio: "ignore", detached: true },
            );
            browserProcess.unref();
            return browserProcess;
          },
          catch: (cause) =>
            new BrowserSpawnError({
              executablePath: profile.browser.executablePath,
              cause: formatError(cause),
            }),
        }),
        (browserProcess) =>
          Effect.sync(() => {
            try {
              browserProcess.kill();
            } catch {
              // HACK: process may have already exited
            }
          }),
      );

      const webSocketUrl = yield* getPageWebSocketUrl(port).pipe(
        Effect.retry(
          Schedule.exponential("500 millis").pipe(
            Schedule.compose(Schedule.recurs(CDP_RETRY_COUNT)),
          ),
        ),
      );

      const response = yield* sendCdpCommand(
        webSocketUrl,
        { id: 1, method: "Network.getAllCookies" },
        port,
      ).pipe(
        Effect.retry(
          Schedule.spaced("1 second").pipe(Schedule.compose(Schedule.recurs(CDP_RETRY_COUNT))),
        ),
      );

      if (response.error) {
        return yield* new CdpConnectionError({
          port,
          cause: `${response.error.message} (code ${response.error.code})`,
        }).asEffect();
      }

      const rawCookies = response.result?.cookies ?? [];
      yield* Effect.logInfo("CDP cookies extracted", {
        profile: profile.profileName,
        count: rawCookies.length,
      });

      return rawCookies.map((raw) => toProfileCookie(raw, profile));
    }, Effect.scoped);

    return { extractFromProfile } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));

  static layerTest = Layer.effect(this)(
    Effect.gen(function* () {
      return {
        extractFromProfile: () => Effect.succeed([] as Cookie[]),
      } as const;
    }),
  );
}
