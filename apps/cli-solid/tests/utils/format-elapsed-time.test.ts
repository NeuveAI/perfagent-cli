import { describe, test, expect } from "bun:test";
import { formatElapsedTime } from "../../src/utils/format-elapsed-time";

describe("formatElapsedTime", () => {
  test("0ms returns 0s", () => {
    expect(formatElapsedTime(0)).toBe("0s");
  });

  test("negative ms clamps to 0s", () => {
    expect(formatElapsedTime(-500)).toBe("0s");
  });

  test("500ms returns 0s (floors to seconds)", () => {
    expect(formatElapsedTime(500)).toBe("0s");
  });

  test("999ms returns 0s", () => {
    expect(formatElapsedTime(999)).toBe("0s");
  });

  test("1000ms returns 1s", () => {
    expect(formatElapsedTime(1000)).toBe("1s");
  });

  test("1500ms returns 1s (floors)", () => {
    expect(formatElapsedTime(1500)).toBe("1s");
  });

  test("30000ms returns 30s", () => {
    expect(formatElapsedTime(30_000)).toBe("30s");
  });

  test("59999ms returns 59s", () => {
    expect(formatElapsedTime(59_999)).toBe("59s");
  });

  test("60000ms returns 1m 0s", () => {
    expect(formatElapsedTime(60_000)).toBe("1m 0s");
  });

  test("61000ms returns 1m 1s", () => {
    expect(formatElapsedTime(61_000)).toBe("1m 1s");
  });

  test("90000ms returns 1m 30s", () => {
    expect(formatElapsedTime(90_000)).toBe("1m 30s");
  });

  test("120000ms returns 2m 0s", () => {
    expect(formatElapsedTime(120_000)).toBe("2m 0s");
  });

  test("3661000ms returns 61m 1s", () => {
    expect(formatElapsedTime(3_661_000)).toBe("61m 1s");
  });
});
