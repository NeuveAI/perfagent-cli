import { describe, expect, it } from "vitest";

import { extractCookies } from "../src/sqlite/extract.js";
import { CookieJar } from "../src/jar.js";
import { formatCookieHeader } from "../src/utils/format-cookie-header.js";

const GOOGLE_URL = "https://google.com";

describe("extractCookies", () => {
  it("handles bare hostname without protocol", async () => {
    const result = await extractCookies({ url: "google.com" });
    expect(Array.isArray(result.cookies)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("handles unknown browser names gracefully", async () => {
    const result = await extractCookies({
      url: GOOGLE_URL,
      browsers: ["nonexistent" as "chrome"],
    });
    expect(result.cookies).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns cookies and warnings arrays", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    expect(Array.isArray(result.cookies)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("every cookie has all required fields with correct types", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    for (const cookie of result.cookies) {
      expect(typeof cookie.name).toBe("string");
      expect(cookie.name.length).toBeGreaterThan(0);
      expect(typeof cookie.value).toBe("string");
      expect(typeof cookie.domain).toBe("string");
      expect(cookie.domain.length).toBeGreaterThan(0);
      expect(typeof cookie.path).toBe("string");
      expect(cookie.path.startsWith("/")).toBe(true);
      expect(typeof cookie.secure).toBe("boolean");
      expect(typeof cookie.httpOnly).toBe("boolean");
      expect(typeof cookie.browser).toBe("string");
    }
  });

  it("expires is undefined or a valid unix timestamp in the future", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    const now = Math.floor(Date.now() / 1000);
    for (const cookie of result.cookies) {
      if (cookie.expires !== undefined) {
        expect(cookie.expires).toBeGreaterThan(0);
        expect(cookie.expires).toBeGreaterThan(now);
        expect(cookie.expires).toBeLessThan(253_402_300_799);
      }
    }
  });

  it("sameSite is undefined or Strict/Lax/None", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    for (const cookie of result.cookies) {
      if (cookie.sameSite !== undefined) {
        expect(["Strict", "Lax", "None"]).toContain(cookie.sameSite);
      }
    }
  });

  it("deduplicates across browsers", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    const keys = result.cookies.map((cookie) => `${cookie.name}|${cookie.domain}|${cookie.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includeExpired returns more cookies than default", async () => {
    const withExpired = await extractCookies({ url: GOOGLE_URL, includeExpired: true });
    const withoutExpired = await extractCookies({ url: GOOGLE_URL });
    expect(withExpired.cookies.length).toBeGreaterThanOrEqual(withoutExpired.cookies.length);
  });

  it("filters by browser", async () => {
    const all = await extractCookies({ url: GOOGLE_URL });
    if (all.cookies.length === 0) return;

    const browserName = all.cookies[0].browser;
    const filtered = await extractCookies({ url: GOOGLE_URL, browsers: [browserName] });
    expect(filtered.cookies.every((cookie) => cookie.browser === browserName)).toBe(true);
    expect(filtered.cookies.length).toBeLessThanOrEqual(all.cookies.length);
  });

  it("filters by cookie name", async () => {
    const all = await extractCookies({ url: GOOGLE_URL });
    if (all.cookies.length === 0) return;

    const targetName = all.cookies[0].name;
    const filtered = await extractCookies({ url: GOOGLE_URL, names: [targetName] });
    expect(filtered.cookies.every((cookie) => cookie.name === targetName)).toBe(true);
    expect(filtered.cookies.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for nonexistent domain", async () => {
    const result = await extractCookies({
      url: "https://no-cookies-here-xyz-999.test",
    });
    expect(result.cookies).toHaveLength(0);
  });

  it("domain field has no leading dot", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    for (const cookie of result.cookies) {
      expect(cookie.domain.startsWith(".")).toBe(false);
    }
  });

  it("extracts cookies from multiple browsers in parallel", async () => {
    const all = await extractCookies({ url: GOOGLE_URL });
    const browsers = [...new Set(all.cookies.map((cookie) => cookie.browser))];
    if (browsers.length < 2) return;

    const perBrowser = await Promise.all(
      browsers.map((browser) => extractCookies({ url: GOOGLE_URL, browsers: [browser] })),
    );
    const totalPerBrowser = perBrowser.reduce((sum, result) => sum + result.cookies.length, 0);
    expect(totalPerBrowser).toBeGreaterThanOrEqual(all.cookies.length);
  });
});

describe("toCookieHeader", () => {
  it("produces valid Cookie header from real cookies", async () => {
    const result = await extractCookies({ url: GOOGLE_URL });
    if (result.cookies.length === 0) return;

    const header = formatCookieHeader(result.cookies);
    expect(header.length).toBeGreaterThan(0);
    expect(header).not.toContain("\n");

    const pairs = header.split("; ");
    for (const pair of pairs) {
      expect(pair.indexOf("=")).toBeGreaterThan(0);
    }
  });
});

describe("CookieJar with real cookies", () => {
  const getJar = async (): Promise<CookieJar> => {
    const result = await extractCookies({ url: GOOGLE_URL });
    return new CookieJar(result.cookies);
  };

  it("match returns only cookies whose domain matches the URL", async () => {
    const jar = await getJar();
    const matched = jar.match("https://google.com/");
    for (const cookie of matched) {
      expect(cookie.domain === "google.com" || cookie.domain.endsWith(".google.com")).toBe(true);
    }
  });

  it("match includes parent-domain cookies for subdomains", async () => {
    const jar = await getJar();
    const rootMatched = jar.match("https://google.com/");
    const subMatched = jar.match("https://mail.google.com/");
    expect(subMatched.length).toBeGreaterThanOrEqual(rootMatched.length);
  });

  it("match filters secure cookies on http", async () => {
    const jar = await getJar();
    const httpsMatched = jar.match("https://google.com/");
    const httpMatched = jar.match("http://google.com/");
    const secureCount = httpsMatched.filter((cookie) => cookie.secure).length;
    if (secureCount > 0) {
      expect(httpMatched.length).toBeLessThan(httpsMatched.length);
      for (const cookie of httpMatched) {
        expect(cookie.secure).toBe(false);
      }
    }
  });

  it("match handles path-scoped cookies", async () => {
    const jar = await getJar();
    const rootMatched = jar.match("https://mail.google.com/");
    const pathMatched = jar.match("https://mail.google.com/mail/u/0");
    expect(pathMatched.length).toBeGreaterThanOrEqual(rootMatched.length);
  });

  it("match returns empty for unrelated domain", async () => {
    const jar = await getJar();
    expect(jar.match("https://notgoogle.com/")).toHaveLength(0);
  });

  it("toCookieHeader returns empty for unrelated URL", async () => {
    const jar = await getJar();
    expect(jar.toCookieHeader("https://notgoogle.com/")).toBe("");
  });

  it("toPlaywright produces valid entries", async () => {
    const jar = await getJar();
    if (jar.cookies.length === 0) return;

    for (const cookie of jar.toPlaywright()) {
      expect(cookie.domain.startsWith(".")).toBe(true);
      expect(typeof cookie.sameSite).toBe("string");
      expect(["Strict", "Lax", "None"]).toContain(cookie.sameSite);
      expect(typeof cookie.expires).toBe("number");
    }
  });

  it("toPlaywright uses -1 for session cookies", async () => {
    const jar = await getJar();
    const sessionCookies = jar.cookies.filter((cookie) => !cookie.expires);
    if (sessionCookies.length === 0) return;

    const pw = jar.toPlaywright();
    const pwSession = pw.filter((cookie) => cookie.expires === -1);
    expect(pwSession.length).toBe(sessionCookies.length);
  });

  it("toPuppeteer preserves undefined sameSite", async () => {
    const jar = await getJar();
    const noSameSite = jar.cookies.filter((cookie) => !cookie.sameSite);
    if (noSameSite.length === 0) return;

    const pp = jar.toPuppeteer();
    const ppNoSameSite = pp.filter((cookie) => cookie.sameSite === undefined);
    expect(ppNoSameSite.length).toBe(noSameSite.length);
  });

  it("JSON round-trip preserves match behavior", async () => {
    const jar = await getJar();
    const restored = CookieJar.fromJSON(jar.toJSON());

    expect(restored.cookies).toEqual(jar.cookies);
    expect(jar.toCookieHeader("https://google.com/")).toBe(
      restored.toCookieHeader("https://google.com/"),
    );
    expect(jar.toCookieHeader("https://mail.google.com/")).toBe(
      restored.toCookieHeader("https://mail.google.com/"),
    );
  });

  it("JSON round-trip preserves playwright format", async () => {
    const jar = await getJar();
    const restored = CookieJar.fromJSON(jar.toJSON());
    expect(jar.toPlaywright()).toEqual(restored.toPlaywright());
  });
});
