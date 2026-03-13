import { execSync } from "child_process";

const GIT_TIMEOUT_MS = 10000;

export const switchBranch = (branch: string): boolean => {
  try {
    execSync(`git checkout ${branch}`, {
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
};
