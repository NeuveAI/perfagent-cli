import { Layer, Logger, ManagedRuntime } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Analytics, DebugFileLogger, Tracing } from "@neuve/shared/observability";
import { McpSession } from "./mcp-session";
import { OverlayController } from "./overlay-controller";
import { layerOnlyFileLogger } from "@neuve/shared/observability";

export const McpRuntime = ManagedRuntime.make(
  Layer.mergeAll(McpSession.layer, OverlayController.layer).pipe(
    Layer.provideMerge(Analytics.layerPostHog),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(layerOnlyFileLogger),
    Layer.provide(Tracing.layerAxiom("perf-agent-mcp")),
  ),
);
