import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { assert, describe, it } from "vite-plus/test";

import { detectWrapperKey, flattenOneOf } from "../src/mcp-bridge.js";

// The Q9 fix regression test: `flattenOneOf` rewrites the three compound
// browser-mcp tools (`interact`, `observe`, `trace`) from their raw
// `oneOf`-discriminated-union shape into flat object schemas that Gemma 4's
// tool-call template can actually template. Without this rewrite, Gemma emits
// the intended call as `message.content` instead of `message.tool_calls` and
// the executor bails at turn 1 (the 2026-04-24 baseline's 25% floor).
//
// Input fixture is the exact output of
// `node docs/handover/q9-tool-call-gap/probes/list-tools.mjs`, i.e. the OpenAI
// tool shape as served by chrome-devtools-mcp via the MCP bridge.

const testDir = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  testDir,
  "..",
  "..",
  "..",
  "docs",
  "handover",
  "q9-tool-call-gap",
  "probes",
  "browser-mcp-tools.json",
);

interface FixtureTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  };
}

const fixtureTools: readonly FixtureTool[] = JSON.parse(
  fs.readFileSync(fixturePath, "utf8"),
) as FixtureTool[];

const toolsByName = new Map(fixtureTools.map((tool) => [tool.function.name, tool]));

const getParameters = (toolName: string): Record<string, unknown> => {
  const tool = toolsByName.get(toolName);
  assert.isDefined(tool, `fixture missing tool: ${toolName}`);
  return tool!.function.parameters;
};

const containsOneOfDeep = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => containsOneOfDeep(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("oneOf" in record) return true;
    return Object.values(record).some((nested) => containsOneOfDeep(nested));
  }
  return false;
};

describe("flattenOneOf", () => {
  describe("compound browser-mcp tools", () => {
    it("flattens `interact` into a single object schema with no oneOf", () => {
      const parameters = getParameters("interact");
      const flattened = flattenOneOf(parameters) as Record<string, unknown>;

      assert.strictEqual(flattened["type"], "object");
      assert.deepEqual(flattened["required"], ["command"]);
      assert.isFalse(
        containsOneOfDeep(flattened["properties"]),
        "flattened `interact` must not contain any nested `oneOf`",
      );

      const properties = flattened["properties"] as Record<string, Record<string, unknown>>;
      const commandSchema = properties["command"];
      assert.strictEqual(commandSchema?.["type"], "string");
      const commandEnum = commandSchema?.["enum"] as readonly string[];
      assert.includeMembers(
        [...commandEnum],
        [
          "navigate",
          "click",
          "type",
          "fill",
          "press_key",
          "hover",
          "drag",
          "fill_form",
          "upload_file",
          "handle_dialog",
          "wait_for",
          "resize",
          "new_tab",
          "switch_tab",
          "close_tab",
        ],
        "all 15 `interact` variant discriminator values must appear in the command enum",
      );

      // Hoisted per-variant properties from several different variants.
      for (const hoisted of [
        "url", // navigate, new_tab
        "direction", // navigate
        "uid", // click, fill, hover, upload_file
        "double", // click
        "text", // type, wait_for (string collision with array — first-seen wins)
        "key", // press_key
        "fromUid", // drag
        "toUid", // drag
        "elements", // fill_form
        "filePath", // upload_file
        "accept", // handle_dialog
        "timeout", // navigate, wait_for, new_tab
        "width", // resize
        "height", // resize
        "pageId", // switch_tab, close_tab
      ]) {
        assert.isDefined(
          properties[hoisted],
          `expected hoisted property \`${hoisted}\` on flattened interact`,
        );
      }

      // Wrapper property must be dropped — the bridge re-wraps at call time
      // via `detectWrapperKey`.
      assert.isUndefined(
        properties["action"],
        "wrapper property `action` must not survive flattening",
      );
    });

    it("flattens `observe` with the expected command enum and hoisted fields", () => {
      const parameters = getParameters("observe");
      const flattened = flattenOneOf(parameters) as Record<string, unknown>;

      assert.isFalse(containsOneOfDeep(flattened["properties"]));
      assert.deepEqual(flattened["required"], ["command"]);

      const properties = flattened["properties"] as Record<string, Record<string, unknown>>;
      const commandEnum = (properties["command"]?.["enum"] ?? []) as readonly string[];
      assert.includeMembers(
        [...commandEnum],
        ["snapshot", "screenshot", "console", "network", "pages", "evaluate"],
      );

      for (const hoisted of [
        "verbose",
        "filePath",
        "format",
        "quality",
        "uid",
        "fullPage",
        "types",
        "pageSize",
        "pageIdx",
        "includePreservedMessages",
        "reqid",
        "resourceTypes",
        "includePreservedRequests",
        "requestFilePath",
        "responseFilePath",
        "function",
        "args",
      ]) {
        assert.isDefined(
          properties[hoisted],
          `expected hoisted property \`${hoisted}\` on flattened observe`,
        );
      }
      assert.isUndefined(properties["action"]);
    });

    it("flattens `trace` with the expected command enum and hoisted fields", () => {
      const parameters = getParameters("trace");
      const flattened = flattenOneOf(parameters) as Record<string, unknown>;

      assert.isFalse(containsOneOfDeep(flattened["properties"]));
      assert.deepEqual(flattened["required"], ["command"]);

      const properties = flattened["properties"] as Record<string, Record<string, unknown>>;
      const commandEnum = (properties["command"]?.["enum"] ?? []) as readonly string[];
      assert.includeMembers(
        [...commandEnum],
        ["start", "stop", "analyze", "memory", "lighthouse", "emulate"],
      );

      for (const hoisted of [
        "reload",
        "autoStop",
        "filePath",
        "insightSetId",
        "insightName",
        "mode",
        "device",
        "outputDirPath",
        "cpuThrottling",
        "network",
        "viewport",
        "colorScheme",
        "geolocation",
        "userAgent",
      ]) {
        assert.isDefined(
          properties[hoisted],
          `expected hoisted property \`${hoisted}\` on flattened trace`,
        );
      }
      assert.isUndefined(properties["action"]);
    });
  });

  describe("flat browser-mcp tools (pass-through)", () => {
    const flatToolNames: readonly string[] = ["click", "fill", "hover", "select", "wait_for"];

    for (const toolName of flatToolNames) {
      it(`returns \`${toolName}\` unchanged (no oneOf discriminated union)`, () => {
        const parameters = getParameters(toolName);
        const flattened = flattenOneOf(parameters);
        assert.strictEqual(
          flattened,
          parameters,
          `flattenOneOf must return the same reference for flat tool \`${toolName}\``,
        );
      });
    }

    it("does not touch nested `anyOf` on `select.option`", () => {
      const parameters = getParameters("select");
      const flattened = flattenOneOf(parameters) as Record<string, unknown>;
      const properties = flattened["properties"] as Record<string, Record<string, unknown>>;
      assert.isArray(
        properties["option"]?.["anyOf"],
        "`select.option.anyOf` (non-discriminated type union) must be preserved as-is",
      );
    });
  });

  describe("detectWrapperKey", () => {
    it("still detects `action` as the wrapper for the 3 compound tools", () => {
      for (const toolName of ["interact", "observe", "trace"]) {
        const parameters = getParameters(toolName);
        assert.strictEqual(
          detectWrapperKey(parameters),
          "action",
          `detectWrapperKey must return "action" for \`${toolName}\` so call-time re-wrap keeps working`,
        );
      }
    });

    it("returns undefined for flat tools", () => {
      for (const toolName of ["click", "fill", "hover", "select", "wait_for"]) {
        const parameters = getParameters(toolName);
        assert.isUndefined(
          detectWrapperKey(parameters),
          `flat tool \`${toolName}\` must not have a detected wrapper key`,
        );
      }
    });
  });

  describe("edge cases", () => {
    it("returns a safe default for non-object input", () => {
      const flattened = flattenOneOf(undefined);
      assert.deepEqual(flattened, { type: "object", properties: {} });
    });

    it("leaves a schema without `oneOf` untouched", () => {
      const schema = {
        type: "object",
        properties: { foo: { type: "string" } },
        required: ["foo"],
      } as const;
      const flattened = flattenOneOf(schema);
      assert.strictEqual(flattened, schema);
    });

    it("leaves a `oneOf` variant that lacks a `command` discriminator untouched", () => {
      const schema = {
        type: "object",
        properties: {
          payload: {
            oneOf: [
              { type: "object", properties: { kind: { const: "a" } }, required: ["kind"] },
              { type: "object", properties: { kind: { const: "b" } }, required: ["kind"] },
            ],
          },
        },
      } as const;
      const flattened = flattenOneOf(schema);
      assert.strictEqual(
        flattened,
        schema,
        "schemas whose discriminator is not named `command` must pass through unchanged",
      );
    });

    it("merges distinct descriptions for the same property name with ` / `", () => {
      const schema = {
        type: "object",
        properties: {
          action: {
            oneOf: [
              {
                type: "object",
                properties: {
                  command: { type: "string", const: "x" },
                  amount: { type: "number", description: "count for x" },
                },
                required: ["command"],
              },
              {
                type: "object",
                properties: {
                  command: { type: "string", const: "y" },
                  amount: { type: "number", description: "count for y" },
                },
                required: ["command"],
              },
            ],
          },
        },
        required: ["action"],
      } as const;
      const flattened = flattenOneOf(schema) as Record<string, unknown>;
      const properties = flattened["properties"] as Record<string, Record<string, unknown>>;
      assert.strictEqual(properties["amount"]?.["description"], "count for x / count for y");
    });
  });
});
