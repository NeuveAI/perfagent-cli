import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import {
  FLOW_DESCRIPTION_CHAR_LIMIT,
  FLOW_DIRECTORY_INDEX_FILE_NAME,
  SAVED_FLOW_FORMAT_VERSION,
} from "./constants";
import { FlowNotFoundError, FlowParseError, FlowStorageError } from "./flow-storage-errors";
import { formatSavedFlowFile, parseSavedFlowFile } from "./saved-flow-file";
import type {
  BrowserEnvironmentHints,
  SavedFlow,
  SavedFlowFileData,
  SavedFlowSummary,
  TestTarget,
} from "./types";
import { getSavedFlowDirectoryPath } from "./utils/get-saved-flow-directory-path";
import { slugify } from "./utils/slugify";

interface SaveFlowOptions {
  cwd?: string;
  title: string;
  description: string;
  flow: SavedFlow;
  environment?: BrowserEnvironmentHints;
  target: TestTarget;
}

const MARKDOWN_FILE_PATTERN = /\.md$/;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const truncateDescription = (description: string): string =>
  description.length <= FLOW_DESCRIPTION_CHAR_LIMIT
    ? description
    : `${description.slice(0, FLOW_DESCRIPTION_CHAR_LIMIT - 3).trimEnd()}...`;

const createFlowSummary = async (
  filePath: string,
  fileData: SavedFlowFileData,
): Promise<SavedFlowSummary> => {
  const fileStats = await fsPromises.stat(filePath);

  return {
    title: fileData.title,
    description: fileData.description,
    slug: fileData.slug,
    filePath,
    modifiedAtMs: fileStats.mtimeMs,
    savedTargetScope: fileData.savedTargetScope,
    savedTargetDisplayName: fileData.savedTargetDisplayName,
  };
};

const writeFlowDirectoryIndex = async (cwd: string): Promise<void> => {
  const flowDirectoryPath = getSavedFlowDirectoryPath(cwd);
  const savedFlows = await listFlows(cwd);
  const lines = [
    "# Saved Flows",
    "",
    ...(savedFlows.length > 0
      ? savedFlows.map(
          (savedFlow) =>
            `- [${savedFlow.title}](./${path.basename(savedFlow.filePath)}) - ${savedFlow.description}`,
        )
      : ["- No saved flows yet."]),
    "",
  ];

  await fsPromises.mkdir(flowDirectoryPath, { recursive: true });
  await fsPromises.writeFile(
    path.join(flowDirectoryPath, FLOW_DIRECTORY_INDEX_FILE_NAME),
    lines.join("\n"),
    "utf-8",
  );
};

export const saveFlow = async (options: SaveFlowOptions): Promise<string> => {
  const cwd = options.cwd ?? options.target.cwd;
  const flowDirectoryPath = getSavedFlowDirectoryPath(cwd);
  const slug = slugify(options.title);
  const filePath = path.join(flowDirectoryPath, `${slug}.md`);
  const flowFileData: SavedFlowFileData = {
    formatVersion: SAVED_FLOW_FORMAT_VERSION,
    title: options.title,
    description: truncateDescription(options.description),
    slug,
    savedTargetScope: options.target.scope,
    savedTargetDisplayName: options.target.displayName,
    selectedCommit: options.target.selectedCommit,
    flow: options.flow,
    environment: options.environment ?? {},
  };

  try {
    await fsPromises.mkdir(flowDirectoryPath, { recursive: true });
    await fsPromises.writeFile(filePath, formatSavedFlowFile(flowFileData), "utf-8");
    await writeFlowDirectoryIndex(cwd);
    return filePath;
  } catch (error) {
    throw new FlowStorageError({
      operation: "save",
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
};

export const loadFlow = async (filePath: string): Promise<SavedFlowFileData> => {
  let content: string;

  try {
    content = await fsPromises.readFile(filePath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new FlowNotFoundError({ lookupType: "filePath", lookupValue: filePath });
    }

    throw new FlowStorageError({
      operation: "load",
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const parsedFlow = parseSavedFlowFile(content);
  if (!parsedFlow) {
    throw new FlowParseError({ filePath });
  }

  return parsedFlow;
};

export const loadFlowBySlug = async (
  slug: string,
  cwd: string = process.cwd(),
): Promise<SavedFlowFileData> => {
  const filePath = path.join(getSavedFlowDirectoryPath(cwd), `${slug}.md`);
  return loadFlow(filePath);
};

export const listFlows = async (cwd: string = process.cwd()): Promise<SavedFlowSummary[]> => {
  const flowDirectoryPath = getSavedFlowDirectoryPath(cwd);
  let directoryEntries: string[];

  try {
    directoryEntries = await fsPromises.readdir(flowDirectoryPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new FlowStorageError({
      operation: "list",
      filePath: flowDirectoryPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const markdownEntries = directoryEntries.filter(
    (entry) => MARKDOWN_FILE_PATTERN.test(entry) && entry !== FLOW_DIRECTORY_INDEX_FILE_NAME,
  );
  const settledResults = await Promise.allSettled(
    markdownEntries.map(async (entry) => {
      const filePath = path.join(flowDirectoryPath, entry);
      const parsedFlow = await loadFlow(filePath);
      return createFlowSummary(filePath, parsedFlow);
    }),
  );

  return settledResults
    .filter(
      (result): result is PromiseSettledResult<SavedFlowSummary> & { status: "fulfilled" } =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((leftFlow, rightFlow) => rightFlow.modifiedAtMs - leftFlow.modifiedAtMs);
};

export const removeFlow = async (filePath: string, cwd: string = process.cwd()): Promise<void> => {
  try {
    await fsPromises.rm(filePath);
    await writeFlowDirectoryIndex(cwd);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new FlowNotFoundError({ lookupType: "filePath", lookupValue: filePath });
    }

    throw new FlowStorageError({
      operation: "remove",
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
};
