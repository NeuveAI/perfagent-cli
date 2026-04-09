import { Effect, FileSystem } from "effect";
import * as path from "node:path";
import { PERF_AGENT_STATE_DIR } from "../constants";

export const ensureStateDir = Effect.fn("Git.ensureStateDir")(function* (
  fileSystem: FileSystem.FileSystem,
  baseDir: string,
) {
  const stateDir = path.join(baseDir, PERF_AGENT_STATE_DIR);

  yield* fileSystem
    .makeDirectory(stateDir, { recursive: true })
    .pipe(Effect.catchTag("PlatformError", () => Effect.void));

  const gitignorePath = path.join(stateDir, ".gitignore");
  const gitignoreExists = yield* fileSystem
    .exists(gitignorePath)
    .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)));

  if (!gitignoreExists) {
    yield* fileSystem
      .writeFileString(gitignorePath, "*\n")
      .pipe(Effect.catchTag("PlatformError", () => Effect.void));
  }

  return stateDir;
});
