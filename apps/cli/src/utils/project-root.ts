import { Effect } from "effect";
import { Git } from "@neuve/supervisor";

export const resolveProjectRoot = () => Effect.runPromise(Git.resolveProjectRoot(process.cwd()));
