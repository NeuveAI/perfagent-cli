import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { assert, describe, it } from "vite-plus/test";

// Regression guard for the local-agent `dist/main.js` runtime crash.
//
// Without the `deps.alwaysBundle: [/@neuve\/shared/]` knob in this package's
// `vite.config.ts`, `vp pack` externalizes the workspace dep `@neuve/shared`
// and leaves `import { parseTraceOutput } from "@neuve/shared/parse-trace-output"`
// (etc.) in the bundled output. At runtime, Node ESM cannot load the `.ts`
// source files that `@neuve/shared`'s package.json `exports` map points at,
// so the child dies in <50ms with `ERR_UNKNOWN_FILE_EXTENSION`. The parent
// `AcpClient` has no spawn-death watcher and silently waits on the ACP
// stdio handshake forever — the calibration sweep's 10-minute testTimeout
// per task.
//
// This test starts the built binary, sends one ACP `initialize` JSON-RPC
// request, and asserts we receive a well-formed response within 5 seconds.
// Much faster than observed (<100 ms on the working fix), but generous
// enough to survive CI variance.

const testDir = path.dirname(url.fileURLToPath(import.meta.url));
const distMain = path.resolve(testDir, "..", "dist", "main.js");

describe("local-agent dist/main.js — ACP initialize smoke test", () => {
  it("has a built dist/main.js (fail early with an actionable message if not)", () => {
    assert.isTrue(
      fs.existsSync(distMain),
      `dist/main.js not found at ${distMain}. ` +
        "Run `pnpm --filter @neuve/local-agent build` first.",
    );
  });

  it("responds to an ACP initialize JSON-RPC request without crashing", async () => {
    const initializeRequest =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientCapabilities: {} },
      }) + "\n";

    const response = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      timedOut: boolean;
    }>((resolve) => {
      const child = childProcess.spawn(process.execPath, [distMain], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        // Resolve as soon as we have a line-terminated JSON-RPC reply.
        if (stdout.includes("\n")) {
          child.kill("SIGTERM");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 5000);

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode, timedOut });
      });

      child.stdin.write(initializeRequest);
      // Keep stdin open briefly so the agent has a chance to read the
      // request; the handshake is synchronous so we don't need to stream
      // further frames to get the first response.
    });

    assert.isFalse(
      response.timedOut,
      `Child timed out after 5s without emitting a response line. ` +
        `stderr=${JSON.stringify(response.stderr)}`,
    );
    assert.notMatch(
      response.stderr,
      /ERR_UNKNOWN_FILE_EXTENSION/,
      "Child emitted ERR_UNKNOWN_FILE_EXTENSION — vite.config.ts alwaysBundle regressed. " +
        `stderr=${JSON.stringify(response.stderr)}`,
    );
    assert.notMatch(
      response.stderr,
      /Cannot find module/,
      `Child emitted a module-resolution error. stderr=${JSON.stringify(response.stderr)}`,
    );

    // The first stdout line must be a JSON-RPC response matching our id=1
    // request, with a `result` carrying `protocolVersion` and
    // `agentCapabilities`. This is the exact happy-path contract the
    // parent AcpClient waits on.
    const firstLine = response.stdout.split("\n").filter((line) => line.length > 0)[0];
    assert.isString(firstLine, "no JSON-RPC response line on stdout");
    const parsed = JSON.parse(firstLine) as {
      jsonrpc?: string;
      id?: number;
      result?: {
        protocolVersion?: number;
        agentCapabilities?: Record<string, unknown>;
      };
      error?: unknown;
    };
    assert.strictEqual(parsed.jsonrpc, "2.0");
    assert.strictEqual(parsed.id, 1);
    assert.isUndefined(
      parsed.error,
      `ACP initialize returned an error: ${JSON.stringify(parsed.error)}`,
    );
    assert.isObject(parsed.result, "ACP initialize result must be an object");
    assert.strictEqual(parsed.result?.protocolVersion, 1);
    assert.isObject(
      parsed.result?.agentCapabilities,
      "ACP initialize result must include agentCapabilities",
    );
  });
});
