import { describe, it, expect, beforeEach } from "vite-plus/test";
import { resetGlobalConfig, configure } from "../src/config";
import { PerfAgent } from "../src/perf-agent";
import { default as PerfAgentDefault } from "../src/index";

describe("PerfAgent.test input validation", () => {
  beforeEach(() => {
    resetGlobalConfig();
  });

  it("throws for empty tests array", () => {
    expect(() => PerfAgent.test({ url: "http://localhost:3000", tests: [] })).toThrow(
      "tests array is empty",
    );
  });

  it("throws when no URL and no baseUrl", () => {
    expect(() => PerfAgent.test({ tests: ["something"] })).toThrow("No URL provided");
  });

  it("throws for relative URL without baseUrl", () => {
    expect(() => PerfAgent.test({ url: "/login", tests: ["something"] })).toThrow(
      "No baseUrl configured",
    );
  });

  it("does not throw when baseUrl is configured", () => {
    configure({ baseUrl: "http://localhost:3000" });
    const run = PerfAgent.test({ url: "/login", tests: ["something"] });
    run.then(
      () => {},
      () => {},
    );
    expect(run).toBeDefined();
  });

  it("uses baseUrl when no url provided", () => {
    configure({ baseUrl: "http://localhost:3000" });
    const run = PerfAgent.test({ tests: ["something"] });
    run.then(
      () => {},
      () => {},
    );
    expect(run).toBeDefined();
  });

  it("throws when function before has no page", () => {
    expect(() =>
      PerfAgent.test({
        url: "http://localhost:3000",
        tests: ["something"],
        before: async () => {},
      }),
    ).toThrow("Function before requires a page");
  });

  it("throws when function after has no page", () => {
    expect(() =>
      PerfAgent.test({
        url: "http://localhost:3000",
        tests: ["something"],
        after: async () => {},
      }),
    ).toThrow("Function after requires a page");
  });

  it("throws when tools are provided", () => {
    expect(() =>
      PerfAgent.test({
        url: "http://localhost:3000",
        tests: ["something"],
        tools: [
          {
            name: "t",
            description: "d",
            inputSchema: { type: "object" as const },
            handler: async () => "",
          },
        ],
      }),
    ).toThrow("Custom tools are not yet supported");
  });
});

describe("PerfAgent.session", () => {
  beforeEach(() => {
    resetGlobalConfig();
  });

  it("creates a session with test method", () => {
    const session = PerfAgent.session({ url: "http://localhost:3000" });
    expect(typeof session.test).toBe("function");
    expect(typeof session.close).toBe("function");
    expect(typeof session[Symbol.asyncDispose]).toBe("function");
  });

  it("session.test throws for empty tests", () => {
    const session = PerfAgent.session({ url: "http://localhost:3000" });
    expect(() => session.test({ tests: [] })).toThrow("tests array is empty");
  });

  it("session.close resolves", async () => {
    const session = PerfAgent.session({ url: "http://localhost:3000" });
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("throws when browserContext is provided", () => {
    expect(() =>
      PerfAgent.session({
        url: "http://localhost:3000",
        browserContext: {} as never,
      }),
    ).toThrow("External browserContext is not yet supported");
  });

  it("throws when tools are provided", () => {
    expect(() =>
      PerfAgent.session({
        url: "http://localhost:3000",
        tools: [
          {
            name: "t",
            description: "d",
            inputSchema: { type: "object" as const },
            handler: async () => "",
          },
        ],
      }),
    ).toThrow("Custom tools are not yet supported");
  });
});

describe("PerfAgent.cookies", () => {
  it("is a function", () => {
    expect(typeof PerfAgent.cookies).toBe("function");
  });
});

describe("default export", () => {
  it("PerfAgent is available as default export", () => {
    expect(PerfAgentDefault).toBe(PerfAgent);
  });
});
