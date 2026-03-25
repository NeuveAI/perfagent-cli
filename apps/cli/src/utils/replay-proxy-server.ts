import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Effect } from "effect";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import { serve } from "@hono/node-server";

interface StartReplayProxyOptions {
  readonly replayHost: string;
  readonly liveViewUrl: string;
}

export interface ReplayProxyHandle {
  readonly url: string;
  readonly close: Effect.Effect<void>;
}

const proxyWebSocketUpgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstreamOrigin: string,
) => {
  const upstreamUrl = new URL(request.url ?? "/", upstreamOrigin);

  const upstreamReq = httpRequest({
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: upstreamUrl.pathname + upstreamUrl.search,
    method: "GET",
    headers: { ...request.headers, host: upstreamUrl.host },
  });

  upstreamReq.on("upgrade", (_res, upstreamSocket, upstreamHead) => {
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${_res.headers["sec-websocket-accept"]}`,
        "",
        "",
      ].join("\r\n"),
    );

    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);

    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);

    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
  });

  upstreamReq.on("error", () => socket.destroy());
  upstreamReq.end();
};

export const startReplayProxy = Effect.fn("startReplayProxy")(function* (
  options: StartReplayProxyOptions,
) {
  const app = new Hono();

  let cachedEvents: unknown[] = [];
  let cachedSteps: unknown = { title: "", status: "running", steps: [] };

  const isTerminalStatus = () => {
    const status = (cachedSteps as Record<string, unknown>)?.status;
    return status === "passed" || status === "failed";
  };

  app.get("/latest.json", async (context) => {
    if (isTerminalStatus()) return context.json(cachedEvents);
    try {
      const upstream = await fetch(`${options.liveViewUrl}/latest.json`);
      if (!upstream.ok) return context.json(cachedEvents);
      const data: unknown[] = await upstream.json();
      if (Array.isArray(data) && data.length > 0) cachedEvents = data;
      return context.json(data);
    } catch {
      return context.json(cachedEvents);
    }
  });

  app.post("/latest.json", async (context) => {
    try {
      const data: unknown[] = await context.req.json();
      if (Array.isArray(data)) cachedEvents = data;
      return new Response(undefined, { status: 204 });
    } catch {
      return new Response(undefined, { status: 400 });
    }
  });

  app.get("/steps", async (context) => {
    if (isTerminalStatus()) return context.json(cachedSteps);
    try {
      const upstream = await fetch(`${options.liveViewUrl}/steps`);
      if (!upstream.ok) return context.json(cachedSteps);
      const data: unknown = await upstream.json();
      cachedSteps = data;
      return context.json(data);
    } catch {
      return context.json(cachedSteps);
    }
  });

  app.post("/steps", async (context) => {
    try {
      const body = await context.req.text();
      const parsed: unknown = JSON.parse(body);
      cachedSteps = parsed;
      const upstream = await fetch(`${options.liveViewUrl}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: Object.fromEntries(upstream.headers.entries()),
      });
    } catch {
      return new Response(undefined, { status: 204 });
    }
  });

  const replayHostParsed = new URL(options.replayHost);

  app.all("/*", async (context) => {
    const requestPath = context.req.path;
    if (requestPath === "/latest.json" || requestPath === "/steps") {
      return context.text("Not Found", 404);
    }

    const upstreamUrl = new URL(requestPath, options.replayHost);
    upstreamUrl.search = new URL(context.req.url).search;

    try {
      return await proxy(upstreamUrl.toString(), {
        headers: {
          "User-Agent": context.req.header("user-agent") ?? "",
          Accept: context.req.header("accept") ?? "*/*",
          Host: replayHostParsed.host,
        },
      });
    } catch (error) {
      console.error(`[replay-proxy] Failed to proxy ${requestPath} to ${upstreamUrl}:`, error);
      return context.text(`Bad Gateway: could not reach ${replayHostParsed.host}`, 502);
    }
  });

  app.onError((error, context) => {
    console.error("[replay-proxy] Unhandled error:", error);
    return context.text("Internal Server Error", 500);
  });

  const serverHandle = yield* Effect.try({
    try: () => serve({ fetch: app.fetch, port: 0 }),
    catch: (cause) => new Error(`Failed to start replay proxy: ${cause}`),
  });

  serverHandle.on("upgrade", (request, socket, head) => {
    proxyWebSocketUpgrade(request, socket, head, options.replayHost);
  });

  const address = serverHandle.address();
  const port =
    typeof address === "object" && address !== undefined && address !== null ? address.port : 0;
  const proxyUrl = `http://localhost:${port}`;

  yield* Effect.logInfo("Replay proxy started", { proxyUrl, liveViewUrl: options.liveViewUrl });

  return {
    url: proxyUrl,
    close: Effect.callback<void>((resume) => {
      serverHandle.close(() => resume(Effect.void));
    }),
  } satisfies ReplayProxyHandle;
});
