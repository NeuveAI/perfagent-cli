import { createContext, useContext, type JSX, type Accessor, createResource } from "solid-js";
import { Effect, Exit } from "effect";
import { Git, GitState } from "@neuve/supervisor";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { useKv, projectPreferencesStorage } from "./kv";

const GIT_STATE_TIMEOUT_MS = 5000;

const NON_GIT_STATE = new GitState({
  isGitRepo: false,
  currentBranch: "HEAD",
  mainBranch: undefined,
  isOnMain: false,
  hasChangesFromMain: false,
  hasUnstagedChanges: false,
  hasBranchCommits: false,
  branchCommitCount: 0,
  fileStats: [],
  workingTreeFileStats: [],
  fingerprint: undefined,
  savedFingerprint: undefined,
});

const fetchGitState = async (): Promise<GitState> => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const git = yield* Git;
      return yield* git.getState();
    }).pipe(
      Effect.provide(Git.withRepoRoot(process.cwd())),
      Effect.catchTag("FindRepoRootError", () => Effect.succeed(NON_GIT_STATE)),
      Effect.timeoutOrElse({
        duration: GIT_STATE_TIMEOUT_MS,
        onTimeout: () => Effect.succeed(NON_GIT_STATE),
      }),
      Effect.provide(NodeServices.layer),
    ),
  );
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  return NON_GIT_STATE;
};

interface ProjectContextValue {
  readonly gitState: Accessor<GitState | undefined>;
  readonly refetchGitState: () => void;
  readonly cookieBrowserKeys: Accessor<string[]>;
  readonly setCookieBrowserKeys: (keys: string[]) => void;
  readonly clearCookieBrowserKeys: () => void;
  readonly lastBaseUrl: Accessor<string | undefined>;
  readonly setLastBaseUrl: (url: string | undefined) => void;
}

const ProjectContext = createContext<ProjectContextValue>();

export const useProject = (): ProjectContextValue => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used inside ProjectProvider");
  }
  return context;
};

interface ProjectProviderProps {
  readonly children: JSX.Element;
}

export const ProjectProvider = (props: ProjectProviderProps) => {
  const kv = useKv();

  // Git state — one-shot fetch with manual refetch
  const [gitState, { refetch: refetchGitState }] = createResource(fetchGitState);

  // Project preferences — backed by per-repo .perf-agent/project-preferences.json
  const [cookieBrowserKeys, setCookieBrowserKeys] = kv.signal<string[]>(
    "project-preferences",
    projectPreferencesStorage,
    "cookieBrowserKeys",
    [],
  );

  const [lastBaseUrl, setLastBaseUrl] = kv.signal<string | undefined>(
    "project-preferences",
    projectPreferencesStorage,
    "lastBaseUrl",
    undefined,
  );

  const clearCookieBrowserKeys = () => setCookieBrowserKeys([]);

  const value: ProjectContextValue = {
    gitState,
    refetchGitState: () => refetchGitState(),
    cookieBrowserKeys,
    setCookieBrowserKeys,
    clearCookieBrowserKeys,
    lastBaseUrl,
    setLastBaseUrl,
  };

  return <ProjectContext.Provider value={value}>{props.children}</ProjectContext.Provider>;
};
