import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { createBrowserMcpServer } from "../../src/mcp/server";
import { McpSession } from "../../src/mcp/mcp-session";
import {
  networkIdleSamplerLayer,
  refResolverLayerUid,
  snapshotTakerLayer,
  waitForEngineLayer,
} from "../../src/tools/live";
import { makeFakeDevTools } from "./live-layer-support";

const buildRuntime = () => {
  const fake = makeFakeDevTools();
  const layer = Layer.mergeAll(
    McpSession.layer,
    refResolverLayerUid,
    networkIdleSamplerLayer,
    snapshotTakerLayer,
    waitForEngineLayer,
  ).pipe(Layer.provideMerge(fake.layer));
  return ManagedRuntime.make(layer);
};

describe("MCP registration for Wave 2.A tools", () => {
  it("exposes click, fill, hover, select, wait_for to tools/list", async () => {
    const runtime = buildRuntime();
    const { server } = createBrowserMcpServer(runtime);

    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await client.listTools();
      const toolNames = listed.tools.map((tool) => tool.name);

      for (const required of ["click", "fill", "hover", "select", "wait_for"]) {
        expect(toolNames).toContain(required);
      }
      for (const existing of ["interact", "observe", "trace"]) {
        expect(toolNames).toContain(existing);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
