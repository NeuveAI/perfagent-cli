import { Layer, References } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { Executor, FlowStorage, Git, Reporter, Updates } from "@expect/supervisor";
import { Agent, AgentBackend } from "@expect/agent";
import { Analytics, DebugFileLoggerLayer } from "@expect/shared/observability";

export const layerCli = ({ verbose, agent }: { verbose: boolean; agent: AgentBackend }) => {
  const gitLayer = Git.withRepoRoot(process.cwd());

  return Layer.mergeAll(
    Executor.layer.pipe(Layer.provide(gitLayer)),
    Reporter.layer,
    Updates.layer,
    FlowStorage.layer,
    DevTools.layer(),
    gitLayer,
    Analytics.layerPostHog,
  ).pipe(
    Layer.provide(Agent.layerFor(agent ?? "claude")),
    Layer.provide(DebugFileLoggerLayer),
    Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, verbose ? "All" : "Error")),
  );
};
