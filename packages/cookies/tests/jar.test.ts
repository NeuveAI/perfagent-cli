import { describe, expect, it } from "vitest";

import {
  matchCookieHeader,
  matchCookies,
  toPlaywrightCookies,
  toPuppeteerCookies,
} from "../src/jar.js";
import type { Cookie } from "../src/types.js";

const cookie = (overrides: Partial<Cookie> = {}): Cookie => ({
  name: "session",
  value: "abc123",
  domain: "example.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
  browser: "chrome",
  ...overrides,
});

describe("matchCookies", () => {
  it("matches cookie by domain", () => {
    expect(matchCookies([cookie()], "https://example.com/")).toHaveLength(1);
  });

  it("matches subdomain against parent domain", () => {
    expect(matchCookies([cookie()], "https://sub.example.com/")).toHaveLength(1);
  });

  it("rejects unrelated domain", () => {
    expect(matchCookies([cookie()], "https://other.com/")).toHaveLength(0);
  });

  it("rejects path mismatch", () => {
    expect(matchCookies([cookie({ path: "/api" })], "https://example.com/")).toHaveLength(0);
  });

  it("matches path prefix", () => {
    expect(matchCookies([cookie({ path: "/api" })], "https://example.com/api/users")).toHaveLength(
      1,
    );
  });

  it("rejects secure cookie on http", () => {
    expect(matchCookies([cookie({ secure: true })], "http://example.com/")).toHaveLength(0);
  });

  it("allows non-secure cookie on http", () => {
    expect(matchCookies([cookie({ secure: false })], "http://example.com/")).toHaveLength(1);
  });

  it("excludes expired cookies", () => {
    expect(matchCookies([cookie({ expires: 1 })], "https://example.com/")).toHaveLength(0);
  });

  it("includes session cookies (no expires)", () => {
    expect(matchCookies([cookie({ expires: undefined })], "https://example.com/")).toHaveLength(1);
  });
});

describe("matchCookieHeader", () => {
  it("formats matching cookies as header", () => {
    const cookies = [cookie({ name: "a", value: "1" }), cookie({ name: "b", value: "2" })];
    expect(matchCookieHeader(cookies, "https://example.com/")).toBe("a=1; b=2");
  });

  it("returns empty string for no matches", () => {
    expect(matchCookieHeader([cookie()], "https://other.com/")).toBe("");
  });
});

describe("toPlaywrightCookies", () => {
  it("maps all fields", () => {
    const [pw] = toPlaywrightCookies([cookie({ expires: 1700000000 })]);
    expect(pw.name).toBe("session");
    expect(pw.value).toBe("abc123");
    expect(pw.domain).toBe(".example.com");
    expect(pw.path).toBe("/");
    expect(pw.expires).toBe(1700000000);
    expect(pw.secure).toBe(true);
    expect(pw.httpOnly).toBe(true);
    expect(pw.sameSite).toBe("Lax");
  });

  it("defaults sameSite to Lax", () => {
    expect(toPlaywrightCookies([cookie({ sameSite: undefined })])[0].sameSite).toBe("Lax");
  });

  it("uses -1 for session cookies", () => {
    expect(toPlaywrightCookies([cookie({ expires: undefined })])[0].expires).toBe(-1);
  });

  it("prefixes domain with dot", () => {
    expect(toPlaywrightCookies([cookie({ domain: "example.com" })])[0].domain).toBe(".example.com");
  });

  it("does not double-dot domain", () => {
    expect(toPlaywrightCookies([cookie({ domain: ".example.com" })])[0].domain).toBe(
      ".example.com",
    );
  });

  it("preserves host-only domains for __Host- cookies", () => {
    expect(
      toPlaywrightCookies([cookie({ name: "__Host-session", domain: "example.com" })])[0].domain,
    ).toBe("example.com");
  });
});

describe("toPuppeteerCookies", () => {
  it("maps all fields", () => {
    const [pp] = toPuppeteerCookies([cookie({ expires: 1700000000, sameSite: "Strict" })]);
    expect(pp.name).toBe("session");
    expect(pp.expires).toBe(1700000000);
    expect(pp.sameSite).toBe("Strict");
  });

  it("preserves undefined sameSite", () => {
    expect(toPuppeteerCookies([cookie({ sameSite: undefined })])[0].sameSite).toBeUndefined();
  });
});

describe("JSON round-trip", () => {
  it("round-trips cookies", () => {
    const original = [cookie({ name: "x", value: "y" })];
    const restored = JSON.parse(JSON.stringify(original)) as Cookie[];
    expect(restored).toEqual(original);
  });

  it("round-trips empty array", () => {
    const restored = JSON.parse(JSON.stringify([])) as Cookie[];
    expect(restored).toEqual([]);
  });
});
