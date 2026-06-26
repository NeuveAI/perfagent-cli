/// <reference path="./which.d.ts" />
import whichSync from "which";

export const isCommandAvailable = (command: string): boolean => {
  try {
    return Boolean(whichSync.sync(command));
  } catch {
    return false;
  }
};
