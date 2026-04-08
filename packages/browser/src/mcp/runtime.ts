import { Layer, Logger, ManagedRuntime } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Analytics,
  DebugFileLogger,
  Tracing,
} from "@expect/shared/observability";
import { McpSession } from "./mcp-session";
import { OverlayController } from "./overlay-controller";

const McpLoggerLayer = Logger.layer([
  Logger.tracerLogger,
  DebugFileLogger,
]).pipe(Layer.provide(NodeServices.layer));

export const McpRuntime = ManagedRuntime.make(
  Layer.mergeAll(McpSession.layer, OverlayController.layer).pipe(
    Layer.provideMerge(Analytics.layerPostHog),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(McpLoggerLayer),
    Layer.provide(Tracing.layerAxiom("expect-mcp"))
  )
);
