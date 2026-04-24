import { Layer } from "effect";
import { Executor, Git, PlanDecomposer } from "@neuve/supervisor";
import { Agent, type AgentBackend } from "@neuve/agent";
import { TokenUsageBus } from "@neuve/shared/token-usage-bus";

export const layerSdk = (agentBackend: AgentBackend, rootDir: string) => {
  const gitLayer = Git.withRepoRoot(rootDir);
  const agentLayer = Agent.layerFor(agentBackend);
  const planDecomposerLayer = PlanDecomposer.layer;
  const executorLayer = Executor.layer.pipe(
    Layer.provide(gitLayer),
    Layer.provide(planDecomposerLayer),
  );

  // Production wiring: tokenomics is an eval-only signal; the noop bus keeps
  // publish-call sites a zero-overhead no-op in the CLI runtime.
  return Layer.mergeAll(executorLayer, gitLayer).pipe(
    Layer.provideMerge(agentLayer),
    Layer.provideMerge(TokenUsageBus.layerNoop),
  );
};
