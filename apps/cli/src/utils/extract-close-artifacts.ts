import type { ExecutionEvent } from "@expect/shared/models";
import { pathToFileURL } from "node:url";

const REPLAY_SESSION_PREFIX = "rrweb replay:";
const REPLAY_REPORT_PREFIX = "rrweb report:";
const PLAYWRIGHT_VIDEO_PREFIX = "Playwright video:";

export interface CloseArtifacts {
  readonly localReplayUrl: string | undefined;
  readonly videoUrl: string | undefined;
  readonly replayPath: string | undefined;
  readonly videoPath: string | undefined;
  readonly replaySessionPath: string | undefined;
}

export const extractCloseArtifacts = (events: readonly ExecutionEvent[]): CloseArtifacts => {
  const closeResult = events
    .slice()
    .reverse()
    .find(
      (event) =>
        event._tag === "ToolResult" &&
        event.toolName === "close" &&
        !event.isError &&
        event.result.length > 0,
    );
  if (!closeResult || closeResult._tag !== "ToolResult") {
    return {
      localReplayUrl: undefined,
      videoUrl: undefined,
      replayPath: undefined,
      videoPath: undefined,
      replaySessionPath: undefined,
    };
  }

  const lines = closeResult.result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const replaySessionRaw = lines
    .find((line) => line.startsWith(REPLAY_SESSION_PREFIX))
    ?.replace(REPLAY_SESSION_PREFIX, "");
  const replayPath = lines
    .find((line) => line.startsWith(REPLAY_REPORT_PREFIX))
    ?.replace(REPLAY_REPORT_PREFIX, "");
  const videoPath = lines
    .find((line) => line.startsWith(PLAYWRIGHT_VIDEO_PREFIX))
    ?.replace(PLAYWRIGHT_VIDEO_PREFIX, "");

  const localReplayUrl =
    replayPath && replayPath.trim().length > 0 ? pathToFileURL(replayPath.trim()).href : undefined;
  const videoUrl =
    videoPath && videoPath.trim().length > 0 ? pathToFileURL(videoPath.trim()).href : undefined;

  const trimmedReplayPath = replayPath?.trim();
  const trimmedVideoPath = videoPath?.trim();
  const trimmedReplaySessionPath = replaySessionRaw?.trim();

  return {
    localReplayUrl,
    videoUrl,
    replayPath: trimmedReplayPath && trimmedReplayPath.length > 0 ? trimmedReplayPath : undefined,
    videoPath: trimmedVideoPath && trimmedVideoPath.length > 0 ? trimmedVideoPath : undefined,
    replaySessionPath:
      trimmedReplaySessionPath && trimmedReplaySessionPath.length > 0
        ? trimmedReplaySessionPath
        : undefined,
  };
};
