import { Layer, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { DevToolsClient } from "@neuve/devtools";
import {
  FlowStorage,
  InsightEnricher,
  Reporter,
  ReportStorage,
  Updates,
  Watch,
} from "@neuve/supervisor";
import type { AgentBackend } from "@neuve/agent";

import { Analytics, DebugFileLoggerLayer, Tracing } from "@neuve/shared/observability";
import { layerSdk } from "@neuve/sdk/effect";

export const layerCli = ({ verbose, agent }: { verbose: boolean; agent: AgentBackend }) => {
  const sdkLayer = layerSdk(agent ?? "claude", process.cwd());
  const watchLayer = Watch.layer.pipe(Layer.provide(sdkLayer));

  const insightEnricherLayer = InsightEnricher.layer.pipe(Layer.provide(DevToolsClient.layer));

  return Layer.mergeAll(
    sdkLayer,
    Reporter.layer,
    ReportStorage.layer,
    insightEnricherLayer,
    Updates.layer,
    FlowStorage.layer,
    DevTools.layer(),
    Analytics.layerPostHog,
    watchLayer,
  ).pipe(
    Layer.provide(DebugFileLoggerLayer),
    Layer.provide(Tracing.layerAxiom("@neuve/perf-agent-cli")),
    Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, verbose ? "All" : "Info")),
  );
};
