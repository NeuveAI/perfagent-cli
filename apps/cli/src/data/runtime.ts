import { Effect, Layer, Option } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { AgentBackend } from "@neuve/agent";
import type { PlannerMode } from "@neuve/supervisor";
import { layerCli } from "../layers";

export const agentProviderAtom = Atom.make<Option.Option<AgentBackend>>(Option.none());
export const verboseAtom = Atom.make(false);
export const plannerModeAtom = Atom.make<PlannerMode>("frontier");

export const cliAtomRuntime = Atom.runtime(
  Effect.fnUntraced(function* (get) {
    const agentProvider = yield* get.some(agentProviderAtom);
    const verbose = get(verboseAtom);
    return layerCli({ verbose, agent: agentProvider });
  }, Layer.unwrap),
).pipe(Atom.keepAlive);
