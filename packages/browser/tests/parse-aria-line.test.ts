import { describe, it, expect } from "vitest";
import { parseAriaLine } from "../src/utils/parse-aria-line";

describe("parseAriaLine", () => {
  it("should parse a role with a quoted name", () => {
    const result = parseAriaLine('- button "Submit"');
    expect(result).toEqual({ role: "button", name: "Submit" });
  });

  it("should parse a role without a name", () => {
    const result = parseAriaLine("- paragraph:");
    expect(result).toEqual({ role: "paragraph", name: "" });
  });

  it("should parse indented lines", () => {
    const result = parseAriaLine('    - link "Click me"');
    expect(result).toEqual({ role: "link", name: "Click me" });
  });

  it("should return null for text role", () => {
    const result = parseAriaLine("- text: hello world");
    expect(result).toBeNull();
  });

  it("should return null for non-matching lines", () => {
    expect(parseAriaLine("just some text")).toBeNull();
    expect(parseAriaLine("")).toBeNull();
    expect(parseAriaLine("  /url: https://example.com")).toBeNull();
  });

  it("should handle names with special characters", () => {
    const result = parseAriaLine('- heading "Hello & Goodbye"');
    expect(result).toEqual({ role: "heading", name: "Hello & Goodbye" });
  });

  it("should handle empty quoted name", () => {
    const result = parseAriaLine('- button ""');
    expect(result).toEqual({ role: "button", name: "" });
  });

  it("should handle escaped quotes in name", () => {
    const result = parseAriaLine('- button "Say \\"hello\\""');
    expect(result).toEqual({ role: "button", name: 'Say "hello"' });
  });

  it("should handle escaped backslash in name", () => {
    const result = parseAriaLine('- button "path\\\\to\\\\file"');
    expect(result).toEqual({ role: "button", name: "path\\to\\file" });
  });

  it("should handle name with mixed escapes", () => {
    const result = parseAriaLine('- link "Click \\"here\\" for C:\\\\docs"');
    expect(result).toEqual({ role: "link", name: 'Click "here" for C:\\docs' });
  });
});
