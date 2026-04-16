import * as childProcess from "node:child_process";

export const copyToClipboard = (text: string): boolean => {
  try {
    childProcess.execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
};
