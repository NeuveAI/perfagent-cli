import { Layer } from "effect";
import { Executor, Git, PlanDecomposer } from "@neuve/supervisor";
import { Agent, type AgentBackend } from "@neuve/agent";

export const layerSdk = (agentBackend: AgentBackend, rootDir: string) => {
  const gitLayer = Git.withRepoRoot(rootDir);
  const agentLayer = Agent.layerFor(agentBackend);
  const planDecomposerLayer = PlanDecomposer.layer;
  const executorLayer = Executor.layer.pipe(
    Layer.provide(gitLayer),
    Layer.provide(planDecomposerLayer),
  );

  return Layer.mergeAll(executorLayer, gitLayer).pipe(Layer.provideMerge(agentLayer));
};
