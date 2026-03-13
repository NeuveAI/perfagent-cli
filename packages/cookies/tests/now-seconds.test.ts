import { describe, expect, it } from "vitest";
import { nowSeconds } from "../src/utils/now-seconds.js";

describe("nowSeconds", () => {
  it("returns a positive integer", () => {
    const result = nowSeconds();
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("returns a value close to Date.now() / 1000", () => {
    const result = nowSeconds();
    const expected = Math.floor(Date.now() / 1000);
    expect(Math.abs(result - expected)).toBeLessThanOrEqual(1);
  });

  it("returns a reasonable Unix timestamp (after 2020)", () => {
    const january2020 = 1577836800;
    expect(nowSeconds()).toBeGreaterThan(january2020);
  });
});
