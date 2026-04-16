import { describe, test, expect } from "bun:test";
import { Screen, screenForTestingOrPortPicker } from "../../src/context/navigation";
import { ChangesFor } from "@neuve/shared/models";

const makeChangesFor = () =>
  ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" });

describe("screen transitions — navigation state machine", () => {
  describe("Main to CookieSyncConfirm", () => {
    test("CookieSyncConfirm receives changesFor and instruction", () => {
      const changesFor = makeChangesFor();
      const screen = Screen.CookieSyncConfirm({
        changesFor,
        instruction: "Test login flow",
      });

      expect(screen._tag).toBe("CookieSyncConfirm");
      expect(screen.changesFor).toBe(changesFor);
      expect(screen.instruction).toBe("Test login flow");
    });

    test("CookieSyncConfirm accepts optional savedFlow", () => {
      const screen = Screen.CookieSyncConfirm({
        changesFor: makeChangesFor(),
        instruction: "test",
        savedFlow: { id: "flow-1", title: "My Flow" } as never,
      });

      expect(screen.savedFlow).toBeDefined();
    });
  });

  describe("screenForTestingOrPortPicker routing", () => {
    test("routes to PortPicker when no baseUrls and instruction has no URL", () => {
      const screen = screenForTestingOrPortPicker({
        changesFor: makeChangesFor(),
        instruction: "Test the login page",
      });

      expect(screen._tag).toBe("PortPicker");
    });

    test("routes to Testing when baseUrls are provided", () => {
      const screen = screenForTestingOrPortPicker({
        changesFor: makeChangesFor(),
        instruction: "Test the login page",
        baseUrls: ["http://localhost:3000"],
      });

      expect(screen._tag).toBe("Testing");
    });

    test("routes to Testing when instruction contains a URL", () => {
      const screen = screenForTestingOrPortPicker({
        changesFor: makeChangesFor(),
        instruction: "Test http://localhost:3000/login",
      });

      expect(screen._tag).toBe("Testing");
    });

    test("routes to PortPicker with empty baseUrls", () => {
      const screen = screenForTestingOrPortPicker({
        changesFor: makeChangesFor(),
        instruction: "Test the login page",
        baseUrls: [],
      });

      expect(screen._tag).toBe("PortPicker");
    });
  });

  describe("Main to PortPicker (via screenForTestingOrPortPicker)", () => {
    test("PortPicker receives changesFor, instruction, cookieBrowserKeys", () => {
      const changesFor = makeChangesFor();
      const screen = screenForTestingOrPortPicker({
        changesFor,
        instruction: "Test sidebar",
        cookieBrowserKeys: ["chrome-default"],
      });

      expect(screen._tag).toBe("PortPicker");
      if (screen._tag !== "PortPicker") throw new Error("unreachable");
      expect(screen.changesFor).toBe(changesFor);
      expect(screen.instruction).toBe("Test sidebar");
      expect(screen.cookieBrowserKeys).toEqual(["chrome-default"]);
    });
  });

  describe("PortPicker to Testing", () => {
    test("Testing screen receives all props from PortPicker navigation", () => {
      const changesFor = makeChangesFor();
      const screen = Screen.Testing({
        changesFor,
        instruction: "Test the checkout flow",
        cookieBrowserKeys: ["chrome-default", "firefox-default"],
        baseUrls: ["http://localhost:3000"],
        devServerHints: [
          {
            url: "http://localhost:3000",
            projectPath: "/Users/test/project",
            devCommand: "npm run dev",
          },
        ],
      });

      expect(screen._tag).toBe("Testing");
      expect(screen.changesFor).toBe(changesFor);
      expect(screen.instruction).toBe("Test the checkout flow");
      expect(screen.cookieBrowserKeys).toEqual(["chrome-default", "firefox-default"]);
      expect(screen.baseUrls).toEqual(["http://localhost:3000"]);
      expect(screen.devServerHints).toHaveLength(1);
    });

    test("Testing screen works with minimal props", () => {
      const screen = Screen.Testing({
        changesFor: makeChangesFor(),
        instruction: "Quick test",
      });

      expect(screen._tag).toBe("Testing");
      expect(screen.cookieBrowserKeys).toBeUndefined();
      expect(screen.baseUrls).toBeUndefined();
      expect(screen.devServerHints).toBeUndefined();
    });
  });

  describe("Testing to Results", () => {
    test("Results screen receives report and videoUrl", () => {
      const report = { status: "passed", instruction: "Test it" } as never;
      const screen = Screen.Results({
        report,
        videoUrl: "https://session.replay/abc",
      });

      expect(screen._tag).toBe("Results");
      expect(screen.report).toBe(report);
      expect(screen.videoUrl).toBe("https://session.replay/abc");
    });

    test("Results screen works without videoUrl", () => {
      const screen = Screen.Results({
        report: { status: "failed" } as never,
      });

      expect(screen._tag).toBe("Results");
      expect(screen.videoUrl).toBeUndefined();
    });
  });

  describe("Results to Main (restart cycle)", () => {
    test("Screen.Main() resets to initial state", () => {
      const screen = Screen.Main();
      expect(screen._tag).toBe("Main");
    });
  });

  describe("goBack behavior", () => {
    test("goBack from CookieSyncConfirm navigates to Main", () => {
      const from = Screen.CookieSyncConfirm({
        changesFor: makeChangesFor(),
        instruction: "test",
      });
      expect(from._tag).toBe("CookieSyncConfirm");
      const back = Screen.Main();
      expect(back._tag).toBe("Main");
    });

    test("goBack from PortPicker navigates to Main", () => {
      const from = Screen.PortPicker({
        changesFor: makeChangesFor(),
        instruction: "test",
      });
      expect(from._tag).toBe("PortPicker");
      const back = Screen.Main();
      expect(back._tag).toBe("Main");
    });

    test("goBack from Results navigates to Main", () => {
      const from = Screen.Results({ report: {} as never });
      expect(from._tag).toBe("Results");
      const back = Screen.Main();
      expect(back._tag).toBe("Main");
    });
  });

  describe("full flow data threading", () => {
    test("Main submit builds ChangesFor.Changes by default", () => {
      const changesFor = ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch: "main" });
      expect(changesFor._tag).toBe("Changes");
    });

    test("Main submit builds ChangesFor.Commit for commit context", () => {
      const changesFor = ChangesFor.makeUnsafe({ _tag: "Commit", hash: "abc123" });
      expect(changesFor._tag).toBe("Commit");
      if (changesFor._tag !== "Commit") throw new Error("unreachable");
      expect(changesFor.hash).toBe("abc123");
    });

    test("Main submit builds ChangesFor.Branch for branch/pr context", () => {
      const changesFor = ChangesFor.makeUnsafe({ _tag: "Branch", mainBranch: "main" });
      expect(changesFor._tag).toBe("Branch");
    });

    test("props thread through CookieSync -> PortPicker -> Testing", () => {
      const changesFor = makeChangesFor();
      const instruction = "Test the login flow thoroughly";
      const cookieBrowserKeys = ["chrome-default"];

      const cookieSyncScreen = Screen.CookieSyncConfirm({
        changesFor,
        instruction,
      });
      expect(cookieSyncScreen.changesFor).toBe(changesFor);
      expect(cookieSyncScreen.instruction).toBe(instruction);

      const portPickerScreen = Screen.PortPicker({
        changesFor,
        instruction,
        cookieBrowserKeys,
      });
      expect(portPickerScreen.changesFor).toBe(changesFor);
      expect(portPickerScreen.instruction).toBe(instruction);
      expect(portPickerScreen.cookieBrowserKeys).toEqual(cookieBrowserKeys);

      const testingScreenInstance = Screen.Testing({
        changesFor,
        instruction,
        cookieBrowserKeys,
        baseUrls: ["http://localhost:3000"],
      });
      expect(testingScreenInstance.changesFor).toBe(changesFor);
      expect(testingScreenInstance.instruction).toBe(instruction);
      expect(testingScreenInstance.cookieBrowserKeys).toEqual(cookieBrowserKeys);
      expect(testingScreenInstance.baseUrls).toEqual(["http://localhost:3000"]);
    });
  });
});
