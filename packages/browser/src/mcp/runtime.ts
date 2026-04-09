import { Layer, ManagedRuntime } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Analytics, Tracing } from "@neuve/shared/observability";
import { McpSession } from "./mcp-session";
import { DevToolsClient } from "../devtools-client";
import { layerOnlyFileLogger } from "@neuve/shared/observability";

export const McpRuntime = ManagedRuntime.make(
  Layer.mergeAll(McpSession.layer, DevToolsClient.layer).pipe(
    Layer.provideMerge(Analytics.layerPostHog),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(layerOnlyFileLogger),
    Layer.provide(Tracing.layerAxiom("perf-agent-mcp")),
  ),
);
