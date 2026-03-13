import type { Locator, Page } from "playwright";
import { snapshot } from "./snapshot";
import type { SnapshotOptions, SnapshotResult } from "./types";

export const interact = async (
  page: Page,
  ref: string,
  action: (locator: Locator) => Promise<void>,
  options?: SnapshotOptions,
): Promise<SnapshotResult> => {
  const before = await snapshot(page, options);
  await action(before.locator(ref));
  return snapshot(page, options);
};
