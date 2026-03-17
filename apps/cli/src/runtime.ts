import { Layer, ManagedRuntime } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { FlowStorage } from "./utils/flow-storage.js";

export const CliRuntime = ManagedRuntime.make(Layer.merge(FlowStorage.layer, DevTools.layer()));
