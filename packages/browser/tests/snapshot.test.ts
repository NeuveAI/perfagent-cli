import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { snapshot } from "../src/snapshot";

describe("snapshot", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe("tree and refs", () => {
    it("should return a tree with refs", async () => {
      await page.setContent(`
        <html><body>
          <h1>Hello World</h1>
          <a href="/about">About</a>
        </body></html>
      `);

      const result = await snapshot(page);
      expect(result.tree).toContain("heading");
      expect(result.tree).toContain("Hello World");
      expect(result.tree).toContain("[ref=e1]");
      expect(typeof result.refs).toBe("object");
      expect(Object.keys(result.refs).length).toBeGreaterThan(0);
    });

    it("should assign sequential ref ids", async () => {
      await page.setContent(`
        <html><body>
          <button>First</button>
          <button>Second</button>
          <button>Third</button>
        </body></html>
      `);

      const result = await snapshot(page);
      expect(result.refs.e1).toBeDefined();
      expect(result.refs.e2).toBeDefined();
      expect(result.refs.e3).toBeDefined();
    });

    it("should store role and name in refs", async () => {
      await page.setContent(`
        <html><body>
          <button>Submit</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const buttonRef = Object.values(result.refs).find((entry) => entry.name === "Submit");
      expect(buttonRef).toBeDefined();
      expect(buttonRef?.role).toBe("button");
    });

    it("should handle empty name", async () => {
      await page.setContent(`
        <html><body>
          <button></button>
        </body></html>
      `);

      const result = await snapshot(page);
      const buttonRef = Object.values(result.refs).find((entry) => entry.role === "button");
      expect(buttonRef).toBeDefined();
      expect(buttonRef?.name).toBe("");
    });
  });

  describe("nth disambiguation", () => {
    it("should set nth on duplicate role+name entries", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
          <button>OK</button>
          <button>Cancel</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const okButtons = Object.values(result.refs).filter(
        (entry) => entry.role === "button" && entry.name === "OK",
      );
      expect(okButtons.length).toBe(2);
      expect(okButtons[0].nth).toBe(0);
      expect(okButtons[1].nth).toBe(1);
    });

    it("should not set nth on unique role+name entries", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
          <button>Cancel</button>
        </body></html>
      `);

      const result = await snapshot(page);
      for (const entry of Object.values(result.refs)) {
        expect(entry.nth).toBeUndefined();
      }
    });
  });

  describe("locator", () => {
    it("should resolve ref to a working locator", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <button>Click Me</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const buttonRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].name === "Click Me",
      );
      expect(buttonRefKey).toBeDefined();

      const locator = result.locator(buttonRefKey!);
      const text = await locator.textContent();
      expect(text).toBe("Click Me");
    });

    it("should throw on unknown ref with available refs", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
        </body></html>
      `);
      const result = await snapshot(page);
      expect(() => result.locator("nonexistent")).toThrow("available refs: e1");
    });

    it("should throw on unknown ref with empty page hint", async () => {
      await page.setContent("<html><body></body></html>");
      const result = await snapshot(page);
      expect(() => result.locator("e1")).toThrow("no refs available");
    });

    it("should click the correct element via ref", async () => {
      await page.setContent(`
        <html><body>
          <button onclick="document.title='clicked'">Click Me</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const buttonRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].name === "Click Me",
      );
      await result.locator(buttonRefKey!).click();
      expect(await page.title()).toBe("clicked");
    });

    it("should click the correct unnamed button among named buttons", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
          <button onclick="document.title='unnamed'"></button>
          <button>Cancel</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const unnamedButtons = Object.entries(result.refs).filter(
        ([, entry]) => entry.role === "button" && !entry.name,
      );
      expect(unnamedButtons.length).toBe(1);

      const [refKey] = unnamedButtons[0];
      await result.locator(refKey).click();
      expect(await page.title()).toBe("unnamed");
    });

    it("should click the correct duplicate button via nth", async () => {
      await page.setContent(`
        <html><body>
          <button onclick="document.title='first'">OK</button>
          <button onclick="document.title='second'">OK</button>
        </body></html>
      `);

      const result = await snapshot(page);
      const okButtons = Object.entries(result.refs).filter(
        ([, entry]) => entry.role === "button" && entry.name === "OK",
      );
      expect(okButtons.length).toBe(2);

      await result.locator(okButtons[1][0]).click();
      expect(await page.title()).toBe("second");
    });

    it("should fill an input via ref", async () => {
      await page.setContent(`
        <html><body>
          <label for="email">Email</label>
          <input id="email" type="text" />
        </body></html>
      `);

      const result = await snapshot(page);
      const inputRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].role === "textbox",
      );
      expect(inputRefKey).toBeDefined();

      await result.locator(inputRefKey!).fill("test@example.com");
      const value = await page.locator("#email").inputValue();
      expect(value).toBe("test@example.com");
    });

    it("should select an option via ref", async () => {
      await page.setContent(`
        <html><body>
          <label for="color">Color</label>
          <select id="color">
            <option value="red">Red</option>
            <option value="blue">Blue</option>
          </select>
        </body></html>
      `);

      const result = await snapshot(page);
      const selectRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].role === "combobox",
      );
      expect(selectRefKey).toBeDefined();

      await result.locator(selectRefKey!).selectOption("blue");
      const value = await page.locator("#color").inputValue();
      expect(value).toBe("blue");
    });
  });

  describe("timeout", () => {
    it("should accept a custom timeout", async () => {
      await page.setContent("<html><body><p>Hello</p></body></html>");
      const result = await snapshot(page, { timeout: 5000 });
      expect(result.tree).toContain("paragraph");
    });
  });
});
