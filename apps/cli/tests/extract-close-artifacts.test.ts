import { describe, expect, it } from "vite-plus/test";
import { pathToFileURL } from "node:url";
import { ToolResult } from "@expect/shared/models";
import { extractCloseArtifacts } from "../src/utils/extract-close-artifacts";
import type { ExecutionEvent } from "@expect/shared/models";

const makeCloseResult = (result: string): ExecutionEvent =>
  new ToolResult({ toolName: "close", result, isError: false });

const makeErrorCloseResult = (result: string): ExecutionEvent =>
  new ToolResult({ toolName: "close", result, isError: true });

const makeOtherToolResult = (result: string): ExecutionEvent =>
  new ToolResult({ toolName: "snapshot", result, isError: false });

describe("extractCloseArtifacts", () => {
  describe("when no close event exists", () => {
    it("returns all undefined for empty events array", () => {
      const artifacts = extractCloseArtifacts([]);

      expect(artifacts.localReplayUrl).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
      expect(artifacts.replayPath).toBeUndefined();
      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.replaySessionPath).toBeUndefined();
    });

    it("returns all undefined when events have no close tool result", () => {
      const events: ExecutionEvent[] = [
        makeOtherToolResult("some result"),
        makeOtherToolResult("another result"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.localReplayUrl).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
      expect(artifacts.replayPath).toBeUndefined();
      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.replaySessionPath).toBeUndefined();
    });

    it("returns all undefined when close result is an error", () => {
      const events: ExecutionEvent[] = [
        makeErrorCloseResult("rrweb report: /tmp/report.html\nPlaywright video: /tmp/video.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.localReplayUrl).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
    });

    it("returns all undefined when close result is empty", () => {
      const events: ExecutionEvent[] = [
        new ToolResult({ toolName: "close", result: "", isError: false }),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.localReplayUrl).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
    });
  });

  describe("extracting replay report path", () => {
    it("extracts replay path and converts to file URL", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nrrweb report: /tmp/expect-replays/report.html"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/expect-replays/report.html");
      expect(artifacts.localReplayUrl).toBe(pathToFileURL("/tmp/expect-replays/report.html").href);
    });

    it("trims whitespace from replay path", () => {
      const events: ExecutionEvent[] = [makeCloseResult("rrweb report:   /tmp/report.html  ")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/report.html");
    });
  });

  describe("extracting video path", () => {
    it("extracts video path and converts to file URL", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nPlaywright video: /tmp/videos/session.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/videos/session.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/videos/session.webm").href);
    });

    it("trims whitespace from video path", () => {
      const events: ExecutionEvent[] = [makeCloseResult("Playwright video:   /tmp/video.webm  ")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/video.webm");
    });
  });

  describe("extracting replay session path", () => {
    it("extracts replay session NDJSON path", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nrrweb replay: /tmp/expect-replays/session.ndjson"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replaySessionPath).toBe("/tmp/expect-replays/session.ndjson");
    });

    it("trims whitespace from session path", () => {
      const events: ExecutionEvent[] = [makeCloseResult("rrweb replay:   /tmp/session.ndjson  ")];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replaySessionPath).toBe("/tmp/session.ndjson");
    });
  });

  describe("extracting all artifacts together", () => {
    it("extracts all artifacts from a complete close result", () => {
      const closeText = [
        "Browser closed.",
        "rrweb replay: /tmp/replays/session.ndjson",
        "rrweb report: /tmp/replays/report.html",
        "Playwright video: /tmp/replays/video.webm",
      ].join("\n");
      const events: ExecutionEvent[] = [makeCloseResult(closeText)];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replaySessionPath).toBe("/tmp/replays/session.ndjson");
      expect(artifacts.replayPath).toBe("/tmp/replays/report.html");
      expect(artifacts.videoPath).toBe("/tmp/replays/video.webm");
      expect(artifacts.localReplayUrl).toBe(pathToFileURL("/tmp/replays/report.html").href);
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/replays/video.webm").href);
    });

    it("handles partial artifacts — only replay, no video", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nrrweb report: /tmp/report.html"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/report.html");
      expect(artifacts.localReplayUrl).toBe(pathToFileURL("/tmp/report.html").href);
      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
      expect(artifacts.replaySessionPath).toBeUndefined();
    });

    it("handles partial artifacts — only video, no replay", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("Browser closed.\nPlaywright video: /tmp/video.webm"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.videoPath).toBe("/tmp/video.webm");
      expect(artifacts.videoUrl).toBe(pathToFileURL("/tmp/video.webm").href);
      expect(artifacts.replayPath).toBeUndefined();
      expect(artifacts.localReplayUrl).toBeUndefined();
    });
  });

  describe("uses the last close event", () => {
    it("picks the last successful close result when multiple exist", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("rrweb report: /tmp/first-report.html"),
        makeOtherToolResult("irrelevant"),
        makeCloseResult("rrweb report: /tmp/second-report.html"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/second-report.html");
    });

    it("skips error close results and finds last successful one", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("rrweb report: /tmp/good-report.html"),
        makeErrorCloseResult("rrweb report: /tmp/error-report.html"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/good-report.html");
    });
  });

  describe("edge cases", () => {
    it("returns undefined for whitespace-only paths", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("rrweb report:   \nPlaywright video:   \nrrweb replay:   "),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBeUndefined();
      expect(artifacts.videoPath).toBeUndefined();
      expect(artifacts.replaySessionPath).toBeUndefined();
      expect(artifacts.localReplayUrl).toBeUndefined();
      expect(artifacts.videoUrl).toBeUndefined();
    });

    it("handles paths with spaces", () => {
      const events: ExecutionEvent[] = [
        makeCloseResult("rrweb report: /tmp/my folder/report file.html"),
      ];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/my folder/report file.html");
      expect(artifacts.localReplayUrl).toBe(pathToFileURL("/tmp/my folder/report file.html").href);
    });

    it("handles lines with extra whitespace and blank lines", () => {
      const closeText = "\n  Browser closed.  \n\n  rrweb report: /tmp/report.html  \n\n";
      const events: ExecutionEvent[] = [makeCloseResult(closeText)];

      const artifacts = extractCloseArtifacts(events);

      expect(artifacts.replayPath).toBe("/tmp/report.html");
    });
  });
});
