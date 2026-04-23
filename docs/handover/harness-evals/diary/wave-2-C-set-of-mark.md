# Wave 2.C — Set-of-Mark visual grounding module

Date: 2026-04-23
Owner: `set-of-mark-eng` (team `harness-evals`)
Task: #7 — blocks Wave 3 (#8); coordinated with Wave 2.A (#5) on `packages/browser/` file scope.

## What shipped

New module `packages/browser/src/set-of-mark.ts` exports:

- `SetOfMark` service (`@devtools/SetOfMark`) with `render(options?)` → `SomRenderResult` and `resolveRef(refId)` → `SomResolvedRef | RefStaleError`.
- `enumerateInteractiveFromTree(root: SomDomNode)` — pure, deterministic enumeration used by both tests and (inlined inside) the in-page `evaluate_script` overlay.
- Schemas: `SomRef`, `SomRefBounds`. Errors: `RefStaleError`, `SomRenderError`.
- Constants: `SOM_MAX_IMAGE_WIDTH_PX = 768`, `SOM_JPEG_QUALITY = 70`, `SOM_OVERLAY_ID`, `SOM_REF_DATA_ATTRIBUTE`.

Tests at `packages/browser/tests/set-of-mark.test.ts` — 10 tests, all passing (verified by running `pnpm --filter @neuve/devtools test` twice consecutively to prove determinism).

No Wave 2.A files (`packages/browser/src/tools/`) were touched.

## Design

### Ref numbering algorithm

Deterministic document-order walk. Numbers start at `1`, incremented only for elements that are **not excluded** AND **visible** AND **interactive**.

Exclusion (short-circuits recursion — an `aria-hidden` subtree contributes zero refs):

- `aria-hidden="true"`
- `disabled` attribute present (`""` or `"true"`)

Visibility:

- `display: none`, `visibility: hidden`, `opacity === 0`
- zero-size or off-viewport `getBoundingClientRect`

Interactive set (matches the plan + observed Volvo-config needs):

- tags: `a`, `button`, `input`, `select`, `textarea`
- `role=` in `{button, link, checkbox, radio, switch, menuitem, tab, option, combobox, searchbox, textbox}`
- `[onclick]`
- `[tabindex]` != `-1`
- `[contenteditable]` in `{"", "true"}`

The in-page script uses `document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)` — native tree-order, same visit order every call, no dependence on Set/Map iteration quirks. That's the determinism guarantee the plan requires.

The pure `enumerateInteractiveFromTree` helper uses explicit recursive `walk(node)` over `node.children` in array order so the same contract holds in tests without a DOM.

### Overlay rendering approach

**DOM-injected overlay, not pixel drawing.** Deliberately avoided bringing in `node-canvas`, `sharp`, or `libvips` — the browser package did not previously depend on any of them, and the plan explicitly permits injecting a `<div>` before screenshotting.

Flow:

1. `evaluate_script` → enumerate + annotate each interactive element with `data-neuve-som-ref="N"` + append a `position:fixed` overlay container `#__neuve_som_overlay__` to `document.body` containing one absolutely-positioned `<div>` per ref. Each overlay box has a yellow (`#facc15`) outline + translucent fill and a black-bordered yellow label with the ref id in 12px monospace — the plan's "yellow box + black number" contrast requirement.
2. `take_screenshot` with format `jpeg` (quality 70) by default — meets the plan's "JPEG q70 is fine" sizing guidance. Callers can opt into `image/png` via `options.format`.
3. Cleanup `evaluate_script` removes the overlay and strips the `data-neuve-som-ref` attributes. Cleanup failure is logged but does not fail the render — a stale overlay on a page about to be re-rendered is not worth failing the turn.

The overlay container uses `z-index: 2147483647` and `pointer-events: none` so it never intercepts clicks from downstream interaction-tool calls (2.A's `click(ref)`).

Note on `SOM_MAX_IMAGE_WIDTH_PX = 768`: the constant is exported for the 2.A/prompt integration to reference when deciding final image bytes for the agent. The current implementation does not re-scale client-side — the chrome-devtools-mcp `take_screenshot` happens at the emulated viewport. Resizing belongs with whatever places the image in the agent's context (Wave 2.B / 3), not here; this module's job is to produce faithful bytes + refs.

### Interface contract that 2.A consumes

2.A's `RefResolver` (from `packages/browser/src/tools/types.ts`, already landed) returns an `ElementHandle` keyed by a `ToolRef` (branded string). 2.A will wire its live `RefResolver` implementation to call into this module via:

```ts
const som = yield* SetOfMark;
const ref = yield* som.resolveRef(refId); // SomResolvedRef | RefStaleError
// ref.selector is a rooted nth-of-type CSS path usable by 2.A's click/fill/hover
// to query the element, e.g. via evaluate_script(`document.querySelector(${JSON.stringify(ref.selector)})`)
```

Key shape 2.A needs to build an `ElementHandle` around:

- `ref.id: string` — 1-indexed
- `ref.selector: string` — `html > body > nav:nth-of-type(1) > a:nth-of-type(2)` form, rooted at `html`
- `ref.bounds: { x, y, width, height }` — useful for hover/click offset calculations
- `ref.role: string`
- `ref.accessibleName?: string`

2.A will continue to own `RefResolver.layer`. This module exposes the data it needs; it does not implement `RefResolver` itself — that's 2.A's scope and avoids the file-ownership conflict.

Also note: each interactive element additionally carries `data-neuve-som-ref="N"` at render time, which 2.A can alternatively match on for added robustness (`document.querySelector('[data-neuve-som-ref="3"]')`). Exported `SOM_REF_DATA_ATTRIBUTE` makes that contract discoverable.

### Stale-ref handling

`resolveRef` tracks `(pageUrl, renderId)` in a `Ref<RefRegistry>` inside the service. On each call it issues `evaluate_script("window.location.href")` and compares to the URL captured at the last successful `render()`:

- Never-rendered state → `RefStaleError` with `reason="no active Set-of-Mark render — call render() first"`.
- URL changed since last render → `RefStaleError` with `reason="page navigated from X to Y"`.
- URL stable but refId not in the current map → `RefStaleError` with the known id set in the reason for the agent to self-correct.

This is the "structured error, not crash" the plan demanded, so the adherence gate (Wave 1.B) can see `RefStaleError` as a retryable domain error rather than a DevToolsToolError defect. Agents/tooling should `Effect.catchTag("RefStaleError", () => rerender-then-retry)`.

### Error hygiene

- No `Effect.mapError`, `catchAll`, `orElseSucceed`, `option`, or `ignore`. Every recovery is a narrow `catchTag("DevToolsToolError", ...)` producing a domain `SomRenderError` or `RefStaleError`.
- `SchemaError` → converted to `SomRenderError` with the schema message attached (the enumeration script is under our control; a schema failure is recoverable at the Effect boundary — the agent can retry).
- `DevToolsToolError` → `SomRenderError` / `RefStaleError` — never silently dropped.
- Cleanup script failure → `Effect.logWarning` only — explicitly expected (finalizer semantics, non-fatal).

### Module-level choices

- Used `ServiceMap.Service` with explicit generic shape (per CLAUDE.md pattern for abstract services) and `static layerWithoutDevTools` + `static layer` split — the second provides the real `DevToolsClient.layer` by default, the first is exposed for tests to inject a stub. This matches the "Platform-Specific Logic in Layers" / layered-test-double spirit without adding a separate test-layer file.
- All effectful methods use `Effect.fn("SetOfMark.*")` with `Effect.annotateCurrentSpan` for observability — matches the backend logging requirement.
- No `null`, no `as` except `as const` on the service record and one `as unknown as ServiceMap.Service.Shape<typeof DevToolsClient>` in tests for the fake-devtools stub.

## Tests

`packages/browser/tests/set-of-mark.test.ts` — 10 tests total, 2 consecutive runs produced identical outputs.

### Pure enumeration layer (4 tests)

| # | Test | What it proves |
|---|------|----------------|
| 1 | 10-interactive fixture — header links/buttons + form inputs + role=button `<div>` | `refs.length === 10`, ids `"1".."10"`, each role matches tag (`link`, `button`, `textbox`, `checkbox`, `select`, `textbox`, `button`, `button`), accessible name preserved. |
| 2 | Determinism — call twice on same tree | ids, selectors, roles identical across runs. |
| 3 | Hidden / aria-hidden / disabled / zero-size exclusion | 5-button fixture with 3 excluded → exactly 2 refs returned, and they are the **visible** ones. |
| 4 | nth-of-type selector shape | 3 sibling `<a>` tags → selectors `body > nav:nth-of-type(1) > a:nth-of-type(N)` for N=1..3. |

### Service layer (6 tests) — mocked `DevToolsClient`

A `makeFakeDevToolsLayer(state)` helper provides a stub `DevToolsClient` whose `evaluateScript` dispatches on script content (`window.location.href` → URL, `TreeWalker`/`getBoundingClientRect` → enumeration payload, else cleanup). `takeScreenshot` returns a base64 PNG/JPEG. No real browser launched — matches the plan's "mock the chrome-devtools-mcp proxy" constraint.

| # | Test | What it proves |
|---|------|----------------|
| 5 | `render()` returns image + mime + refs | Service round-trips JPEG bytes, mimeType, and all 10 refs; `takeScreenshot` called exactly once per render. |
| 6 | `render()` determinism | Two consecutive renders on the same page yield identical id/selector lists. |
| 7 | `resolveRef("3")` happy path | Returns `{ id:"3", role:"button", accessibleName:"Build" }` after a prior render. |
| 8 | `resolveRef` stale detection | Mutate the stub's `currentUrl` between `render()` and `resolveRef()` → returns `RefStaleError` whose `.reason` starts with `"page navigated from https://example.com/buy"`. Uses `Effect.flip` to land the error as a value. |
| 9 | `resolveRef` no-render state | Call `resolveRef` without a prior `render()` → `RefStaleError` with reason `"no active Set-of-Mark render"`. |
| 10 | Public attribute constant | `SOM_REF_DATA_ATTRIBUTE === "data-neuve-som-ref"` — locks the contract 2.A's `RefResolver` (or anyone else) can rely on. |

### Verification

- `pnpm --filter @neuve/devtools test` — 10/10 passing, 211ms, run twice with identical results.
- `pnpm --filter @neuve/devtools typecheck` — no errors on `set-of-mark.ts` (pre-existing 2.A failures in `tools/live.ts` + `tools/interactions.ts` remain; out of scope for this wave).
- `pnpm --filter @neuve/perf-agent-cli typecheck` + `pnpm --filter cli-solid typecheck` — same story: zero errors traceable to `set-of-mark.ts`; 2.A's in-flight files still red.
- `pnpm --filter @neuve/devtools format:check` (implicit via `pnpm check`) — clean on my two files. The broader `pnpm check` lint step fails due to an unrelated project-wide oxlint config issue (`defineConfig()` not wrapping the root `vite.config.mjs`) — not introduced by this wave and not in scope.

## Deviations from the seed prompt

- **Used `@neuve/devtools` not `@neuve/browser`** in all pnpm invocations — the package is named `@neuve/devtools` in `package.json`, not `@neuve/browser`. The seed's `pnpm --filter @neuve/browser ...` commands don't match the workspace; treated as a naming mismatch and substituted.
- **Exposed a `layerWithoutDevTools` layer alongside `layer`.** Seed shows a single `static layer` with optional `Layer.provide(...)` comment. Split was necessary to let tests inject a stub `DevToolsClient` without constructing the real stdio MCP client. This is additive and does not change the default `SetOfMark.layer` surface the rest of the codebase consumes.
- **Did not register a new `set_of_mark` MCP tool.** The seed marked this as optional ("only if you need to expose it"). 2.A has not yet integrated, and prompts.ts exposure is 2.B's job. Adding a public MCP tool now would commit to a schema before the consumers are ready — deferred to a follow-up PR once 2.A/2.B converge.
- **`SOM_MAX_IMAGE_WIDTH_PX` is exported but not enforced inside the module.** The seed mentions "Render at ≤768px width max" — the right place to enforce that is wherever the image is attached to the agent turn (2.B/2.A integration), not at screenshot capture time where the emulated viewport is the single source of truth. Exporting the constant gives that integration a stable hook.
- **No explicit Schema class for `SomRenderResult`.** It's an interface over primitives because its `image: Uint8Array` is a runtime value (not a JSON-serializable field). `SomRef` and `SomRefBounds` are proper schemas since they round-trip through the `evaluate_script` JSON payload.

## Follow-ups (not this wave)

1. 2.A wires `RefResolver.live` to call `SetOfMark.resolveRef` and resolve the `selector` to a real element handle — either via `data-neuve-som-ref` attribute query or the nth-of-type selector. Once 2.A's `tools/live.ts` typechecks, a small integration test can land in `packages/browser/tests/` to prove the `click(ref)` → SOM resolve → real click path.
2. 2.B's `<available_actions>` block should document `click(N) / fill(N, text) / hover(N)` and reference that refs come from the SOM screenshot attached to each turn. The ref lifetime (stable until next `render()` / page navigation) is the contract to document.
3. If the 4B agent proves confused by >~25 refs per screen, add a `maxRefs` option with a deterministic cull (e.g. keep closest-to-viewport-top N). Not needed until post-baseline scores say so.
