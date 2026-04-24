import { assert, describe, it } from "vite-plus/test";
import { ExecutedTrace, KeyNode, ToolCall } from "../src/task";
import { summarizeTrajectory } from "../src/runners/trajectory-summary";

const buildTrace = (overrides: Partial<ExecutedTrace> = {}): ExecutedTrace =>
  new ExecutedTrace({
    reachedKeyNodes: overrides.reachedKeyNodes ?? [
      new KeyNode({ urlPattern: "https://site.com/", domAssertion: "body" }),
      new KeyNode({ urlPattern: "https://site.com/details", domAssertion: "body" }),
    ],
    toolCalls: overrides.toolCalls ?? [
      new ToolCall({
        name: "browse",
        arguments: { url: "https://site.com/", hint: "landing" },
        wellFormed: true,
      }),
      new ToolCall({
        name: "click",
        arguments: { ref: "3", label: "Details" },
        wellFormed: true,
      }),
    ],
    finalUrl: overrides.finalUrl ?? "https://site.com/details",
    finalDom: overrides.finalDom ?? "Details page rendered",
  });

describe("summarizeTrajectory", () => {
  it("lists reached key nodes, tool calls, and final URL/summary", () => {
    const summary = summarizeTrajectory(buildTrace());
    assert.include(summary, "Key nodes reached (2)");
    assert.include(summary, "https://site.com/");
    assert.include(summary, "https://site.com/details");
    assert.include(summary, "Tool calls issued (2)");
    assert.include(summary, "browse(");
    assert.include(summary, "click(");
    assert.include(summary, "Final URL: https://site.com/details");
    assert.include(summary, "Final summary: Details page rendered");
  });

  it("flags malformed tool calls and omits well-formed flag otherwise", () => {
    const trace = buildTrace({
      toolCalls: [
        new ToolCall({
          name: "bad-call",
          arguments: { raw: "not-json" },
          wellFormed: false,
        }),
        new ToolCall({
          name: "good-call",
          arguments: { key: "value" },
          wellFormed: true,
        }),
      ],
    });
    const summary = summarizeTrajectory(trace);
    assert.include(summary, "bad-call");
    assert.include(summary, "[malformed]");
    assert.include(summary, "good-call");
    assert.notInclude(summary.split("good-call")[1] ?? "", "[malformed]");
  });

  it("redacts sensitive keys (api_key, token, authorization, password, secret)", () => {
    const trace = buildTrace({
      toolCalls: [
        new ToolCall({
          name: "login",
          arguments: {
            url: "https://site.com/",
            api_key: "sk-LEAKED",
            token: "TOKEN-LEAKED",
            password: "PW-LEAKED",
            authorization: "Bearer LEAKED",
            secret: "SECRET-LEAKED",
          },
          wellFormed: true,
        }),
      ],
    });
    const summary = summarizeTrajectory(trace);
    assert.notInclude(summary, "sk-LEAKED");
    assert.notInclude(summary, "TOKEN-LEAKED");
    assert.notInclude(summary, "PW-LEAKED");
    assert.notInclude(summary, "LEAKED");
    assert.include(summary, "url=");
  });

  it("caps the summary length at ~2KB", () => {
    const trace = buildTrace({
      toolCalls: Array.from(
        { length: 200 },
        (_, index) =>
          new ToolCall({
            name: `tool_${index}`,
            arguments: { payload: "x".repeat(200) },
            wellFormed: true,
          }),
      ),
    });
    const summary = summarizeTrajectory(trace);
    assert.isAtMost(summary.length, 2048 + "…[truncated]".length);
    assert.include(summary, "…[truncated]");
  });

  it("handles empty traces gracefully", () => {
    const trace = new ExecutedTrace({
      reachedKeyNodes: [],
      toolCalls: [],
      finalUrl: "",
      finalDom: "",
    });
    const summary = summarizeTrajectory(trace);
    assert.include(summary, "Key nodes reached: none");
    assert.include(summary, "no tool calls were issued");
    assert.include(summary, "Final URL: <none>");
    assert.include(summary, "Final summary: <none>");
  });
});
