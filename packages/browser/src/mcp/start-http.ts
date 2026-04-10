import * as fs from "node:fs";
import * as http from "node:http";
import { Effect, Predicate } from "effect";
import { DevToolsClient } from "../devtools-client";
import { McpSession } from "./mcp-session";
import { McpRuntime } from "./runtime";
import { CLI_SESSION_FILE, MAX_DAEMON_REQUEST_BODY_BYTES } from "./constants";

const readRequestBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DAEMON_REQUEST_BODY_BYTES) {
        settled = true;
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });

const parseArgs = (body: string): Record<string, unknown> => {
  if (body.length === 0) return {};
  const parsed: unknown = JSON.parse(body);
  if (!Predicate.isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const httpServer = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const toolName = req.url?.slice(1);
  if (!toolName) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing tool name in URL path" }));
    return;
  }

  try {
    const body = await readRequestBody(req);
    const args = parseArgs(body);

    const result = await McpRuntime.runPromise(
      Effect.gen(function* () {
        const devtools = yield* DevToolsClient;
        const session = yield* McpSession;

        const resolvedArgs = { ...args };
        if (
          (toolName === "navigate_page" || toolName === "new_page") &&
          typeof args.url === "string"
        ) {
          resolvedArgs.url = session.resolveUrl(args.url);
        }

        return yield* devtools.callTool(toolName, resolvedArgs);
      }),
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const removeSessionFile = () => {
  try {
    fs.unlinkSync(CLI_SESSION_FILE);
  } catch {
    // HACK: best-effort cleanup — file may already be gone
  }
};

const shutdown = () => {
  removeSessionFile();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("beforeExit", removeSessionFile);

httpServer.listen(0, "127.0.0.1", () => {
  const address = httpServer.address();
  if (typeof address === "object" && address) {
    fs.writeFileSync(CLI_SESSION_FILE, JSON.stringify({ pid: process.pid, port: address.port }));
    process.stderr.write(`perf-agent daemon listening on 127.0.0.1:${address.port}\n`);
  }
});
