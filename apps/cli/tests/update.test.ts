import { describe, expect, it } from "vite-plus/test";
import {
  buildPerfAgentMcpServerConfig,
  formatPerfAgentMcpVersion,
  getPerfAgentMcpPackageSpecifier,
  inferDistTag,
} from "../src/mcp/install-perf-agent-mcp";

describe("update", () => {
  describe("getPerfAgentMcpPackageSpecifier", () => {
    it("uses the latest release by default", () => {
      expect(getPerfAgentMcpPackageSpecifier()).toBe("@neuve/perf-agent-cli@latest");
    });

    it("uses a specific version when provided", () => {
      expect(getPerfAgentMcpPackageSpecifier("0.0.30")).toBe("@neuve/perf-agent-cli@0.0.30");
    });

    it("strips a leading v from semver versions", () => {
      expect(getPerfAgentMcpPackageSpecifier("v0.0.30")).toBe("@neuve/perf-agent-cli@0.0.30");
    });
  });

  describe("formatPerfAgentMcpVersion", () => {
    it("formats semver versions with a v prefix", () => {
      expect(formatPerfAgentMcpVersion("0.0.30")).toBe("v0.0.30");
    });

    it("preserves dist-tags", () => {
      expect(formatPerfAgentMcpVersion("canary")).toBe("canary");
    });
  });

  describe("inferDistTag", () => {
    it("returns undefined for stable versions", () => {
      expect(inferDistTag("0.0.30")).toBeUndefined();
    });

    it("returns the dist tag for pre-release versions", () => {
      expect(inferDistTag("0.0.30-canary.1")).toBe("canary");
    });

    it("returns the dist tag for other pre-release labels", () => {
      expect(inferDistTag("1.2.3-beta.5")).toBe("beta");
    });

    it("normalizes uppercase tags to lowercase", () => {
      expect(inferDistTag("0.0.30-RC.1")).toBe("rc");
    });

    it("returns undefined for dev", () => {
      expect(inferDistTag("dev")).toBeUndefined();
    });
  });

  describe("buildPerfAgentMcpServerConfig", () => {
    it("builds the default npx command", () => {
      expect(buildPerfAgentMcpServerConfig()).toEqual({
        command: "npx",
        args: ["-y", "@neuve/perf-agent-cli@latest", "mcp"],
      });
    });

    it("pins the requested version", () => {
      expect(buildPerfAgentMcpServerConfig("0.0.30")).toEqual({
        command: "npx",
        args: ["-y", "@neuve/perf-agent-cli@0.0.30", "mcp"],
      });
    });
  });
});
