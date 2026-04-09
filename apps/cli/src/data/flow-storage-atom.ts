import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { FlowStorage } from "@neuve/supervisor";
import type { TestPlan } from "@neuve/shared/models";
import { cliAtomRuntime } from "./runtime";
import * as NodeServices from "@effect/platform-node/NodeServices";

interface SaveFlowInput {
  readonly plan: TestPlan;
}

export const saveFlowFn = cliAtomRuntime.fn(
  Effect.fnUntraced(
    function* (input: SaveFlowInput, _ctx: Atom.FnContext) {
      const flowStorage = yield* FlowStorage;
      const savedFlow = yield* flowStorage.save(input.plan);
      return savedFlow;
    },
    Effect.annotateLogs({ fn: "saveFlowFn" }),
    Effect.provide(NodeServices.layer),
  ),
);
