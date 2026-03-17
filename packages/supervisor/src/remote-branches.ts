import { execFile } from "node:child_process";
import { GIT_TIMEOUT_MS, GITHUB_TIMEOUT_MS, PR_LIMIT } from "./constants.js";
import { commandExists } from "./utils/command-exists.js";

export interface RemoteBranch {
  name: string;
  author: string;
  prNumber: number | null;
  prStatus: "open" | "draft" | "merged" | null;
  updatedAt: string | null;
}

interface GhPullRequest {
  headRefName: string;
  author: { login: string };
  number: number;
  state: string;
  isDraft: boolean;
  updatedAt: string;
}

const normalizePrStatus = (state: string, isDraft: boolean): "open" | "draft" | "merged" => {
  if (state === "MERGED") return "merged";
  if (isDraft) return "draft";
  return "open";
};

const execAsync = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf-8", timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });

const fetchPrs = async (cwd: string, state: string): Promise<GhPullRequest[]> => {
  try {
    const output = await execAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        state,
        "--limit",
        String(PR_LIMIT),
        "--json",
        "headRefName,author,number,state,isDraft,updatedAt",
      ],
      cwd,
      GITHUB_TIMEOUT_MS,
    );
    return JSON.parse(output);
  } catch {
    return [];
  }
};

const getRemoteBranchNames = async (cwd: string): Promise<string[]> => {
  try {
    const output = await execAsync(
      "git",
      ["branch", "-r", "--format=%(refname:short)"],
      cwd,
      GIT_TIMEOUT_MS,
    );
    if (!output) return [];
    return output
      .split("\n")
      .filter(Boolean)
      .filter((ref) => !ref.includes("HEAD"))
      .map((ref) => ref.replace(/^origin\//, ""));
  } catch {
    return [];
  }
};

export const fetchRemoteBranches = async (cwd: string): Promise<RemoteBranch[]> => {
  const branchNames = await getRemoteBranchNames(cwd);

  if (!(await commandExists("gh"))) {
    return branchNames.map((name) => ({
      name,
      author: "",
      prNumber: null,
      prStatus: null,
      updatedAt: null,
    }));
  }

  const [openPrs, mergedPrs] = await Promise.all([fetchPrs(cwd, "open"), fetchPrs(cwd, "merged")]);

  const pullRequestByBranch = new Map<string, GhPullRequest>();
  for (const pullRequest of [...openPrs, ...mergedPrs]) {
    if (!pullRequestByBranch.has(pullRequest.headRefName)) {
      pullRequestByBranch.set(pullRequest.headRefName, pullRequest);
    }
  }

  return branchNames.map((name) => {
    const pullRequest = pullRequestByBranch.get(name);
    return {
      name,
      author: pullRequest?.author.login ?? "",
      prNumber: pullRequest?.number ?? null,
      prStatus: pullRequest ? normalizePrStatus(pullRequest.state, pullRequest.isDraft) : null,
      updatedAt: pullRequest?.updatedAt ?? null,
    };
  });
};
