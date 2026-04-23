import { describe, expect, it } from "vitest";
import { Effect, Layer, ServiceMap } from "effect";
import { DevToolsClient } from "../src/devtools-client";
import {
  enumerateInteractiveFromTree,
  RefStaleError,
  SetOfMark,
  SOM_REF_DATA_ATTRIBUTE,
  type SomDomNode,
  type SomRefBounds,
} from "../src/set-of-mark";

const bounds = (x: number, y: number, width: number, height: number): SomRefBounds => ({
  x,
  y,
  width,
  height,
});

const node = (params: {
  tagName: string;
  attributes?: Record<string, string>;
  children?: ReadonlyArray<SomDomNode>;
  bounds?: SomRefBounds;
  visible?: boolean;
  accessibleName?: string;
}): SomDomNode => ({
  tagName: params.tagName,
  attributes: new Map(Object.entries(params.attributes ?? {})),
  children: params.children ?? [],
  bounds: params.bounds ?? bounds(0, 0, 100, 20),
  visible: params.visible ?? true,
  ...(params.accessibleName !== undefined ? { accessibleName: params.accessibleName } : {}),
});

const tenInteractiveFixture = (): SomDomNode =>
  node({
    tagName: "body",
    bounds: bounds(0, 0, 1024, 900),
    children: [
      node({
        tagName: "header",
        bounds: bounds(0, 0, 1024, 60),
        children: [
          node({
            tagName: "a",
            attributes: { href: "/" },
            accessibleName: "Home",
            bounds: bounds(10, 10, 80, 30),
          }),
          node({
            tagName: "a",
            attributes: { href: "/buy" },
            accessibleName: "Buy",
            bounds: bounds(100, 10, 80, 30),
          }),
          node({
            tagName: "button",
            accessibleName: "Build",
            bounds: bounds(200, 10, 80, 30),
          }),
        ],
      }),
      node({
        tagName: "main",
        bounds: bounds(0, 60, 1024, 800),
        children: [
          node({
            tagName: "form",
            bounds: bounds(0, 60, 1024, 300),
            children: [
              node({
                tagName: "input",
                attributes: { type: "text", name: "first" },
                bounds: bounds(0, 70, 200, 30),
              }),
              node({
                tagName: "input",
                attributes: { type: "text", name: "last" },
                bounds: bounds(210, 70, 200, 30),
              }),
              node({
                tagName: "input",
                attributes: { type: "checkbox", name: "agree" },
                bounds: bounds(0, 110, 20, 20),
              }),
              node({
                tagName: "select",
                attributes: { name: "color" },
                bounds: bounds(0, 140, 200, 30),
              }),
              node({
                tagName: "textarea",
                attributes: { name: "notes" },
                bounds: bounds(0, 180, 400, 60),
              }),
              node({
                tagName: "button",
                attributes: { type: "submit" },
                accessibleName: "Submit",
                bounds: bounds(0, 260, 100, 30),
              }),
            ],
          }),
          node({
            tagName: "div",
            attributes: { role: "button", tabindex: "0" },
            accessibleName: "Fancy action",
            bounds: bounds(500, 400, 120, 40),
          }),
        ],
      }),
    ],
  });

const fakeCallToolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  isError: false,
});

const fakeScreenshotResult = (base64: string, mime: "image/png" | "image/jpeg") => ({
  content: [{ type: "image" as const, data: base64, mimeType: mime }],
  isError: false,
});

interface FakeDevToolsState {
  currentUrl: string;
  enumerationPayload: () => unknown;
  screenshotBase64: string;
  screenshotMime: "image/png" | "image/jpeg";
  evaluateCalls: Array<string>;
  screenshotCalls: number;
}

const makeFakeDevToolsLayer = (state: FakeDevToolsState) => {
  const stub = {
    callTool: () => Effect.succeed({ content: [], isError: false } as unknown),
    listTools: () => Effect.succeed([] as unknown as []),
    navigate: () => Effect.succeed({ content: [], isError: false } as unknown),
    startTrace: () => Effect.succeed({ content: [], isError: false } as unknown),
    stopTrace: () => Effect.succeed({ content: [], isError: false } as unknown),
    analyzeInsight: () => Effect.succeed({ content: [], isError: false } as unknown),
    takeScreenshot: () =>
      Effect.sync(() => {
        state.screenshotCalls += 1;
        return fakeScreenshotResult(state.screenshotBase64, state.screenshotMime);
      }),
    takeSnapshot: () => Effect.succeed({ content: [], isError: false } as unknown),
    emulate: () => Effect.succeed({ content: [], isError: false } as unknown),
    takeMemorySnapshot: () => Effect.succeed({ content: [], isError: false } as unknown),
    lighthouseAudit: () => Effect.succeed({ content: [], isError: false } as unknown),
    evaluateScript: (script: string) =>
      Effect.sync(() => {
        state.evaluateCalls.push(script);
        if (script.includes("window.location.href") && !script.includes("document.body")) {
          return fakeCallToolResult(state.currentUrl);
        }
        if (script.includes("TreeWalker") || script.includes("getBoundingClientRect")) {
          return fakeCallToolResult(state.enumerationPayload());
        }
        return fakeCallToolResult({ cleared: true });
      }),
    listNetworkRequests: () => Effect.succeed({ content: [], isError: false } as unknown),
    listConsoleMessages: () => Effect.succeed({ content: [], isError: false } as unknown),
    closePage: () => Effect.succeed({ content: [], isError: false } as unknown),
  } as unknown as ServiceMap.Service.Shape<typeof DevToolsClient>;
  return Layer.succeed(DevToolsClient, stub);
};

describe("enumerateInteractiveFromTree (pure)", () => {
  it("assigns deterministic 1-indexed numbers to interactive elements in tree order", () => {
    const tree = tenInteractiveFixture();
    const refs = enumerateInteractiveFromTree(tree);
    expect(refs.length).toBe(10);
    expect(refs.map((entry) => entry.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(refs[0].role).toBe("link");
    expect(refs[0].accessibleName).toBe("Home");
    expect(refs[2].role).toBe("button");
    expect(refs[3].role).toBe("textbox");
    expect(refs[5].role).toBe("checkbox");
    expect(refs[6].role).toBe("select");
    expect(refs[7].role).toBe("textbox");
    expect(refs[8].role).toBe("button");
    expect(refs[9].role).toBe("button");
    expect(refs[9].accessibleName).toBe("Fancy action");
  });

  it("produces identical numbering across repeated renders of the same tree", () => {
    const tree = tenInteractiveFixture();
    const first = enumerateInteractiveFromTree(tree);
    const second = enumerateInteractiveFromTree(tree);
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    expect(second.map((entry) => entry.selector)).toEqual(first.map((entry) => entry.selector));
    expect(second.map((entry) => entry.role)).toEqual(first.map((entry) => entry.role));
  });

  it("excludes hidden, aria-hidden, disabled, and zero-size elements", () => {
    const tree = node({
      tagName: "body",
      children: [
        node({ tagName: "button", accessibleName: "Visible A" }),
        node({ tagName: "button", accessibleName: "Hidden", visible: false }),
        node({
          tagName: "button",
          accessibleName: "AriaHidden",
          attributes: { "aria-hidden": "true" },
        }),
        node({
          tagName: "button",
          accessibleName: "Disabled",
          attributes: { disabled: "" },
        }),
        node({ tagName: "button", accessibleName: "Visible B" }),
      ],
    });
    const refs = enumerateInteractiveFromTree(tree);
    expect(refs.length).toBe(2);
    expect(refs[0].accessibleName).toBe("Visible A");
    expect(refs[1].accessibleName).toBe("Visible B");
  });

  it("emits stable nth-of-type selectors rooted at the walker root", () => {
    const tree = node({
      tagName: "body",
      children: [
        node({
          tagName: "nav",
          children: [
            node({ tagName: "a", attributes: { href: "/a" }, accessibleName: "A" }),
            node({ tagName: "a", attributes: { href: "/b" }, accessibleName: "B" }),
            node({ tagName: "a", attributes: { href: "/c" }, accessibleName: "C" }),
          ],
        }),
      ],
    });
    const refs = enumerateInteractiveFromTree(tree);
    expect(refs.map((entry) => entry.selector)).toEqual([
      "body > nav:nth-of-type(1) > a:nth-of-type(1)",
      "body > nav:nth-of-type(1) > a:nth-of-type(2)",
      "body > nav:nth-of-type(1) > a:nth-of-type(3)",
    ]);
  });
});

describe("SetOfMark service", () => {
  const refsForFixture = () =>
    enumerateInteractiveFromTree(tenInteractiveFixture()).map((entry) => ({
      id: entry.id,
      selector: entry.selector,
      role: entry.role,
      bounds: entry.bounds,
      ...(entry.accessibleName !== undefined ? { accessibleName: entry.accessibleName } : {}),
    }));

  it("render() returns image bytes, mimetype, and a ref table aligned with enumeration", async () => {
    const state: FakeDevToolsState = {
      currentUrl: "https://example.com/buy",
      enumerationPayload: () => ({
        pageUrl: "https://example.com/buy",
        viewportWidth: 1024,
        viewportHeight: 900,
        refs: refsForFixture(),
      }),
      screenshotBase64: Buffer.from([137, 80, 78, 71]).toString("base64"),
      screenshotMime: "image/jpeg",
      evaluateCalls: [],
      screenshotCalls: 0,
    };
    const layer = makeFakeDevToolsLayer(state);

    const result = await Effect.gen(function* () {
      const som = yield* SetOfMark;
      return yield* som.render();
    }).pipe(
      Effect.provide(Layer.provide(SetOfMark.layerWithoutDevTools, layer)),
      Effect.runPromise,
    );

    expect(result.refs.length).toBe(10);
    expect(result.refs[0].id).toBe("1");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.image.length).toBe(4);
    expect(state.screenshotCalls).toBe(1);
  });

  it("render() is deterministic across invocations on the same page", async () => {
    const state: FakeDevToolsState = {
      currentUrl: "https://example.com/buy",
      enumerationPayload: () => ({
        pageUrl: "https://example.com/buy",
        viewportWidth: 1024,
        viewportHeight: 900,
        refs: refsForFixture(),
      }),
      screenshotBase64: Buffer.from([0]).toString("base64"),
      screenshotMime: "image/jpeg",
      evaluateCalls: [],
      screenshotCalls: 0,
    };
    const layer = makeFakeDevToolsLayer(state);

    const [first, second] = await Effect.gen(function* () {
      const som = yield* SetOfMark;
      const a = yield* som.render();
      const b = yield* som.render();
      return [a, b] as const;
    }).pipe(
      Effect.provide(Layer.provide(SetOfMark.layerWithoutDevTools, layer)),
      Effect.runPromise,
    );

    expect(second.refs.map((entry) => entry.id)).toEqual(first.refs.map((entry) => entry.id));
    expect(second.refs.map((entry) => entry.selector)).toEqual(
      first.refs.map((entry) => entry.selector),
    );
  });

  it("resolveRef() returns the stored ref when page URL is unchanged", async () => {
    const state: FakeDevToolsState = {
      currentUrl: "https://example.com/buy",
      enumerationPayload: () => ({
        pageUrl: "https://example.com/buy",
        viewportWidth: 1024,
        viewportHeight: 900,
        refs: refsForFixture(),
      }),
      screenshotBase64: "",
      screenshotMime: "image/jpeg",
      evaluateCalls: [],
      screenshotCalls: 0,
    };
    const layer = makeFakeDevToolsLayer(state);

    const ref = await Effect.gen(function* () {
      const som = yield* SetOfMark;
      yield* som.render();
      return yield* som.resolveRef("3");
    }).pipe(
      Effect.provide(Layer.provide(SetOfMark.layerWithoutDevTools, layer)),
      Effect.runPromise,
    );

    expect(ref.id).toBe("3");
    expect(ref.role).toBe("button");
    expect(ref.accessibleName).toBe("Build");
  });

  it("resolveRef() returns RefStaleError after simulated navigation", async () => {
    const state: FakeDevToolsState = {
      currentUrl: "https://example.com/buy",
      enumerationPayload: () => ({
        pageUrl: "https://example.com/buy",
        viewportWidth: 1024,
        viewportHeight: 900,
        refs: refsForFixture(),
      }),
      screenshotBase64: "",
      screenshotMime: "image/jpeg",
      evaluateCalls: [],
      screenshotCalls: 0,
    };
    const layer = makeFakeDevToolsLayer(state);

    const error = await Effect.gen(function* () {
      const som = yield* SetOfMark;
      yield* som.render();
      state.currentUrl = "https://example.com/buy/build";
      return yield* som.resolveRef("3").pipe(Effect.flip);
    }).pipe(
      Effect.provide(Layer.provide(SetOfMark.layerWithoutDevTools, layer)),
      Effect.runPromise,
    );

    expect(error).toBeInstanceOf(RefStaleError);
    expect(error.reason).toContain("page navigated from https://example.com/buy");
  });

  it("resolveRef() fails fast with RefStaleError when render() has never been called", async () => {
    const state: FakeDevToolsState = {
      currentUrl: "https://example.com/",
      enumerationPayload: () => ({
        pageUrl: "",
        viewportWidth: 0,
        viewportHeight: 0,
        refs: [],
      }),
      screenshotBase64: "",
      screenshotMime: "image/jpeg",
      evaluateCalls: [],
      screenshotCalls: 0,
    };
    const layer = makeFakeDevToolsLayer(state);

    const error = await Effect.gen(function* () {
      const som = yield* SetOfMark;
      return yield* som.resolveRef("1").pipe(Effect.flip);
    }).pipe(
      Effect.provide(Layer.provide(SetOfMark.layerWithoutDevTools, layer)),
      Effect.runPromise,
    );

    expect(error).toBeInstanceOf(RefStaleError);
    expect(error.reason).toContain("no active Set-of-Mark render");
  });

  it("uses the SOM ref data attribute when injecting the overlay script", () => {
    expect(SOM_REF_DATA_ATTRIBUTE).toBe("data-neuve-som-ref");
  });
});
