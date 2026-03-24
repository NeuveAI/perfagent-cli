import { Effect, Exit } from "effect";
import { useQuery } from "@tanstack/react-query";
import { Git, type GitState } from "@expect/supervisor";

export type { GitState };

export const useGitState = () =>
  useQuery({
    queryKey: ["git-state"],
    queryFn: async (): Promise<GitState> => {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const git = yield* Git;
          return yield* git.getState();
        }).pipe(Effect.provide(Git.withRepoRoot(process.cwd()))),
      );
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      throw exit.cause;
    },
  });
