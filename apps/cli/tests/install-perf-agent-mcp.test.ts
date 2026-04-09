import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as TOML from "@iarna/toml";
import * as jsoncParser from "jsonc-parser";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CODEX_MCP_STARTUP_TIMEOUT_SEC } from "../src/constants";
import {
  detectInstalledPerfAgentMcpAgents,
  installPerfAgentMcpForAgents,
} from "../src/mcp/install-perf-agent-mcp";

const tempDirectories: string[] = [];

const createTempDirectory = (): string => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "perf-agent-mcp-install-"));
  tempDirectories.push(tempDirectory);
  return tempDirectory;
};

afterEach(() => {
  for (const tempDirectory of tempDirectories.splice(0, tempDirectories.length)) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

describe("installPerfAgentMcpForAgents", () => {
  it("writes a Cursor MCP config", () => {
    const projectRoot = createTempDirectory();

    const summary = installPerfAgentMcpForAgents(projectRoot, ["cursor"], { scope: "project" });

    expect(summary.scope).toBe("project");
    expect(summary.installed).toEqual(["cursor"]);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".cursor/mcp.json"), "utf8"))).toEqual(
      {
        mcpServers: {
          "perf-agent": {
            command: "npx",
            args: ["-y", "@neuve/perf-agent-cli@latest", "mcp"],
          },
        },
      },
    );
  });

  it("writes a Codex MCP config", () => {
    const projectRoot = createTempDirectory();

    const summary = installPerfAgentMcpForAgents(projectRoot, ["codex"], {
      scope: "project",
      version: "0.0.30",
    });

    expect(summary.installed).toEqual(["codex"]);
    expect(
      TOML.parse(fs.readFileSync(path.join(projectRoot, ".codex/config.toml"), "utf8")),
    ).toEqual({
      mcp_servers: {
        "perf-agent": {
          command: "npx",
          args: ["-y", "@neuve/perf-agent-cli@0.0.30", "mcp"],
          startup_timeout_sec: CODEX_MCP_STARTUP_TIMEOUT_SEC,
        },
      },
    });
  });

  it("preserves existing JSON comments and sibling servers", () => {
    const projectRoot = createTempDirectory();
    fs.mkdirSync(path.join(projectRoot, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".cursor/mcp.json"),
      `{
  // keep me
  "mcpServers": {
    "other": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
`,
    );

    installPerfAgentMcpForAgents(projectRoot, ["cursor"], { scope: "project" });

    const content = fs.readFileSync(path.join(projectRoot, ".cursor/mcp.json"), "utf8");
    expect(content).toContain("// keep me");
    expect(jsoncParser.parse(content)).toEqual({
      mcpServers: {
        other: {
          command: "node",
          args: ["server.js"],
        },
        "perf-agent": {
          command: "npx",
          args: ["-y", "@neuve/perf-agent-cli@latest", "mcp"],
        },
      },
    });
  });

  it("writes the OpenCode-specific config shape and detects installs", () => {
    const projectRoot = createTempDirectory();

    const summary = installPerfAgentMcpForAgents(projectRoot, ["opencode"], { scope: "project" });

    expect(summary.installed).toEqual(["opencode"]);
    expect(detectInstalledPerfAgentMcpAgents(projectRoot, ["opencode", "cursor"], "project")).toEqual([
      "opencode",
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toEqual({
      mcp: {
        "perf-agent": {
          type: "local",
          command: ["npx", "-y", "@neuve/perf-agent-cli@latest", "mcp"],
          enabled: true,
        },
      },
    });
  });
});
