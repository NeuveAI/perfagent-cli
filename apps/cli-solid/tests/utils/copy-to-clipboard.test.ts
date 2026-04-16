import { describe, test, expect } from "bun:test";
import { copyToClipboard } from "../../src/utils/copy-to-clipboard";

describe("copyToClipboard", () => {
  test("returns a boolean", () => {
    const result = copyToClipboard("test text");
    expect(typeof result).toBe("boolean");
  });

  test("returns true on macOS (pbcopy available)", () => {
    if (process.platform !== "darwin") return;
    const result = copyToClipboard("hello clipboard");
    expect(result).toBe(true);
  });

  test("handles empty string", () => {
    const result = copyToClipboard("");
    expect(typeof result).toBe("boolean");
  });
});
