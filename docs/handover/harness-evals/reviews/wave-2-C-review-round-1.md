# Review: Wave 2.C — Set-of-Mark visual grounding (Round 1)

## Verdict: APPROVE

### Verification executed

| Command | Outcome |
|---|---|
| `git diff --stat HEAD -- packages/browser/src/set-of-mark.ts packages/browser/tests/set-of-mark.test.ts` | Both files are untracked new files; no other 2.C-owned file touched. |
| `git diff HEAD packages/browser/src/tools/` | empty — Wave 2.A territory untouched. |
| `git diff HEAD packages/browser/src/mcp/` | (files modified but not by 2.C — these belong to 2.A/2.B which are untracked/in-flight adjacent waves; nothing in the 2.C diff references them). |
| `git diff HEAD packages/shared/` | changes exist but owned by Wave 2.B (prompts.ts + prompts.test.ts); unrelated to 2.C deliverables. |
| `git diff HEAD packages/supervisor/` | empty. |
| Read `packages/browser/package.json` | `name: "@neuve/devtools"` — engineer's `@neuve/browser → @neuve/devtools` pnpm-filter substitution is correct. |
| `cd packages/browser && pnpm exec vp test run set-of-mark` run #1 | **10/10 passed**, 213ms. |
| `cd packages/browser && pnpm exec vp test run set-of-mark` run #2 | **10/10 passed**, 213ms. Identical counts — deterministic. |
| `cd packages/browser && pnpm exec vp test run set-of-mark` run #3 | **10/10 passed**, 213ms. Deterministic across three runs. |
| `pnpm --filter @neuve/devtools typecheck` | **zero errors** — set-of-mark.ts + set-of-mark.test.ts clean. |
| `pnpm --filter @neuve/devtools format:check` | All matched files use correct format. |
| `pnpm --filter @neuve/devtools lint` | Fails with *pre-existing* oxlint config load error (`vite.config.mjs` lacking `defineConfig()` wrapper, introduced in unrelated commit `0d70846e`). NOT caused by 2.C. |
| `pnpm --filter @neuve/devtools test` (whole package) | 28/28 passed, confirming 2.C did not regress adjacent waves' tests. |

### Claims-vs-code verification

1. **File scope** — Engineer claims only `set-of-mark.ts`, `set-of-mark.test.ts`, diary. Confirmed — `git status` shows untracked `packages/browser/src/set-of-mark.ts` + `packages/browser/tests/set-of-mark.test.ts` + diary. No modifications to `packages/browser/src/tools/`, `packages/browser/src/mcp/*` *by this wave* (the modified files in those paths belong to adjacent Wave 2.A/2.B untracked changesets; they predate and do not depend on 2.C).
2. **Determinism** — verified above, three identical runs.
3. **1-indexed TreeWalker** — `set-of-mark.ts:291-310` (in-page script) and `:148-174` (pure helper) both start `counter = 0`, increment-then-use so ids are `"1".."N"`. Tree traversal uses `document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)` in the in-page script and explicit recursive `walk(node, selector)` in the pure helper. No `Math.random`, no `Set`/`Map` iteration over unordered keys for numbering.
4. **Pure `enumerateInteractiveFromTree`** — exported and tested; does not require jsdom (tests construct plain `SomDomNode` objects).
5. **Stale-ref tracking via `pageUrl`** — `set-of-mark.ts:483-525` stores `{renderId, pageUrl, refs}` in an `Effect.Ref`, probes `window.location.href` per `resolveRef` call, returns structured `RefStaleError` on mismatch. Verified by test #8 (navigation → `RefStaleError.reason` starts with `"page navigated from https://example.com/buy"`).
6. **`SomResolvedRef` interface** — matches plan contract: `{id, selector, role, bounds, accessibleName?}`. 2.A's `RefResolver` can consume it as claimed.
7. **`layerWithoutDevTools` split** — `:555-556`. Production consumers of `layerWithoutDevTools`: grep shows ZERO hits outside `set-of-mark.ts` (the definition) and `set-of-mark.test.ts` (test consumer). Production code uses `SetOfMark.layer` exclusively. Not a production-vs-test divergence seam — the service `make` is identical; only the upstream dependency layer differs.
8. **No MCP `set_of_mark` tool registered** — confirmed, deferred per diary.
9. **10 tests** — confirmed enumeration structure matches diary: 4 pure-enumeration tests (10-element fixture, determinism, visibility/exclusion, nth-of-type selectors) + 6 service-layer tests (render happy path + screenshot call count, render determinism, resolveRef happy path, resolveRef stale after navigation, resolveRef no-render-yet, public constant lock).

### Antagonistic-checklist results

#### Determinism — THE key constraint

- In-page script uses `document.createTreeWalker(..., NodeFilter.SHOW_ELEMENT)` which emits elements in document order — deterministic per DOM spec.
- Numbering: `counter += 1` only when element passes `!isExcluded && isVisible && isInteractive`. No set/map iteration for numbering.
- Pure helper walks `node.children` in array index order. Deterministic.
- Selectors use `:nth-of-type(N)` computed by counting prior siblings with the same tag — deterministic.
- Ref map is built by iterating `enumeration.refs` in array order (`set-of-mark.ts:474-475`) — stable.

#### Overlay collision with enumeration

- On every render the in-page script *first* removes any prior `#__neuve_som_overlay__` and strips all `data-neuve-som-ref` attributes (`set-of-mark.ts:199-203`) BEFORE walking — so stale overlay state cannot leak into enumeration.
- The overlay is injected AFTER enumeration completes (`:325`) — walker never sees it on the current turn.
- As a belt-and-braces safeguard, the overlay sets `aria-hidden="true"` (`:314`) and the `isExcluded` rule skips `aria-hidden="true"` subtrees — so even if cleanup fails between turns, a subsequent render's walker will short-circuit the overlay.
- Overlay uses `pointer-events: none` (`:315`) — does not intercept 2.A interaction clicks.

#### Effect rules

- `ServiceMap.Service` with explicit interface generic + `make:` + `static layer` — valid (abstract-service pattern from CLAUDE.md). Not `Effect.Service`, not `Context.Tag`.
- All effectful methods use `Effect.fn("SetOfMark.*")` with `Effect.annotateCurrentSpan`.
- No `Effect.mapError`, `catchAll`, `orElseSucceed`, `Effect.option`, `Effect.ignore` — confirmed via grep.
- `interface` preferred over `type` (only 3 unavoidable `type` aliases: `SomMimeType` union + two `typeof X.Type` schema aliases). kebab-case filenames. Arrow functions for non-generator helpers.
- Structured logging via `Effect.logInfo`/`Effect.logWarning`.

#### Errors

- `RefStaleError` and `SomRenderError` are `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`, `message` as class field derived from data. Matches CLAUDE.md Errors rule.
- Error recovery is narrow `catchTag`, never `catchAll`.

#### Ref schema

- `SomRef` has `{id, selector, role, bounds, accessibleName?}` — bounds is REQUIRED (`SomRefBounds` non-optional struct). Matches plan.

#### Verification

All verification commands above. `pnpm check` not run repo-wide due to the *pre-existing* oxlint config error unrelated to 2.C; 2.C's own formatter and tsgo checks pass clean.

### Findings

- [MINOR] `set-of-mark.ts:352, 364, 395, 409` — four `as` casts on MCP response shapes while extracting `content[]` entries. These are at the parse boundary where `devtools.callTool` returns loosely-typed `CallToolResult`. Could be replaced by a `Schema.Struct({ content: Schema.Array(...) })` decode to match the "Prefer Schemas Over Fragile Property Checks" rule, but would require introducing a schema for MCP envelope shapes. Not a correctness issue; the runtime guards (`!content || content.length === 0`, `entry.type === "text"`) cover the real failure modes. Non-blocking.

- [MINOR] `set-of-mark.ts:519-525` — URL-based stale detection is strict string equality on `window.location.href`. This correctly catches same-origin query/hash changes as navigation, but does NOT catch SPA history-API updates that keep the URL constant (e.g. `history.replaceState` with same path). Any such transition would serve stale refs to the caller. Diary does not call this out explicitly. Acceptable for now since 2.C's contract is URL-based; flag for 2.A/2.B integration to consider a fresher signal (e.g. DOM-mutation observer or `performance.navigation` timestamp). Non-blocking.

- [MINOR] `set-of-mark.ts:555-556` — `SetOfMark.layerWithoutDevTools` is exposed publicly solely so tests can inject a stub `DevToolsClient`. Grep confirms zero production callers. This is a lesser cousin of the "optional fetcher default" anti-pattern (project memory `feedback_no_test_only_injection_seams`) — the service `make` is identical between prod and test paths, so there is no code-divergence seam; only the upstream layer differs. Cleaner alternative would be for tests to construct the stub-backed layer inline via `Layer.provide(Layer.effect(SetOfMark)(SetOfMark.make), fakeDevToolsLayer)` without exposing a second named layer on the class. Not a blocker; diary justifies the split.

- [MINOR] Engineer chose `ServiceMap.Service<SetOfMark, {…}>()("@devtools/SetOfMark", { make })` — the combined "abstract-with-make" form. CLAUDE.md's two examples are either (a) concrete single-generic + `make:` (Cookies) or (b) abstract double-generic without `make:` (CodingAgent). Engineer's form compiles and typechecks cleanly. Slightly non-idiomatic but not wrong. Non-blocking.

- [INFO] `set-of-mark.ts:547-550` — `getCurrentPageUrl` is exposed on the service interface but never used by any test or production call site. Presumably useful for 2.A later; otherwise dead code risk. Non-blocking.

- [INFO] `SOM_MAX_IMAGE_WIDTH_PX = 768` is exported but not enforced inside this module. Diary explicitly justifies this as the 2.A/2.B integration's responsibility (viewport emulation is the real source of truth). Reasonable.

### Suggestions (non-blocking)

- If a follow-up needs to harden the SPA-navigation case, consider tracking `renderId` client-side via a data attribute on `<body>` (e.g. `data-neuve-som-render-id`) and checking its presence in `resolveRef` — survives same-URL history updates that blow away the DOM.
- If the four `as` casts on MCP envelopes start appearing in 2.A's tools/*, consider a shared `McpResponse` schema in `packages/browser/src/mcp/response.ts` to decode once and reuse.
- Consider adding one integration test (in a follow-up) that wires `SetOfMark.layer` against the real `DevToolsClient` + a local static HTML fixture served via `file://` — would prove the in-page script actually executes as expected in the real Chrome binary used by `chrome-devtools-mcp`. Today's tests use a stub `evaluateScript` that pattern-matches the script text — they prove the service contract but not the in-page JS itself.
- The diary calls out a future `maxRefs` cull; if added, document the cull ordering (viewport-proximity) in the SOM `SomRenderOptions` so callers can rely on it.

### Summary

Wave 2.C delivers exactly the 2.C DoD: deterministic numbering, exclusion of hidden/aria-hidden/disabled/zero-size elements, `nth-of-type` stable selectors, overlay injected via DOM (no node-canvas dependency), structured `RefStaleError` on navigation, 10 tests deterministic across three consecutive runs. No 2.A or 2.B files were modified as part of this wave. Scope is clean. Effect rules and CLAUDE.md style are respected.

Findings are all Minor/Info and explicitly justified or deferred in the engineer's diary. None of them block merge.

**Verdict: APPROVE.**
