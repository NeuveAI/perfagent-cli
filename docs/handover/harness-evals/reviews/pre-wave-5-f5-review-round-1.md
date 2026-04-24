# Review: Pre-Wave-5 — F5 real-runner URL extraction fix (Round 1)

## Verdict: APPROVE

## Verification executed

- `git status` + `git diff --stat` — scope clean: only 4 artifacts (1 new module, 1 runner edit, 1 test edit, 1 new diary). No changes under `packages/browser/`, `packages/evals/src/scorers/`, `packages/evals/src/adapters/`, `packages/supervisor/`, `packages/shared/`, `apps/`, or `packages/evals/evalite.config.ts`.
- `pnpm --filter @neuve/evals test` — **88/88 passed** on run 1 (624ms), **88/88 passed** on run 2 (575ms). Deterministic across back-to-back runs.
- `pnpm --filter @neuve/evals typecheck` — clean, zero errors.
- `pnpm --filter @neuve/evals format:check` — fails in `src/scorers/final-state.ts`, `tests/mock-runner.test.ts`, `tests/scorers.test.ts`. All three are pre-existing drift per `git log` (commits `62746a41`, `4ce748e3`), NOT touched by this fix.
- `pnpm typecheck` (repo-wide) — only the pre-existing `@neuve/sdk` playwright-module error persists. All other packages green including `@neuve/evals`, `@neuve/perf-agent-cli`, `cli-solid`.
- Upstream format verification against `node_modules/chrome-devtools-mcp/build/src/`:
  - `Successfully navigated to ${url}.` at `tools/pages.js:179` — matches `NAVIGATED_PATTERN`.
  - `${pageId}: ${url}${selected ? " [selected]" : ""}` at `McpResponse.js:437` and `:452` — matches `PAGES_SELECTED_PATTERN`.
  - `URL: ${summary.url}` at `McpResponse.js:507` (plus the two trace-insights sites in `third_party/index.js:173824,173835`) — matches `TRACE_URL_PATTERN`.
  - Snapshot formatter emits `uid=${id} ${role} "${name}" ... url="${val}"` at `formatters/SnapshotFormatter.js:52,76`. For the page root, `id` format is `${snapshotId}_0` — matches `ROOT_WEB_AREA_PATTERN`.
- Replay against captured Wave 2.A traces: reconstructed the extractor in Python and ran it against the three `real__calibration-{1,2,3}-*.ndjson` files. Output URLs match the diary's replay table byte-for-byte:
  - calibration-1: `tc-001`, `tc-002` → `https://docs.python.org/3/`.
  - calibration-2: `tc-001`, `tc-002` → `https://www.bbc.com/news`.
  - calibration-3: `tc-001` → `https://developer.mozilla.org/`, `tc-002` → `https://developer.mozilla.org/en-US/`.
- Byte-identical `extractUrlFromToolInput` confirmed by `git show HEAD:packages/evals/src/runners/real.ts` vs. the new `url-extraction.ts`: function body is identical, only `const` → `export const` changed.

## Findings

- [INFO] Diary overstates calibration-3's projected `reachedKeyNodes` gain (docs/handover/harness-evals/diary/pre-wave-5-f5-url-extraction-fix.md:144) — claims "0 -> 2" but calibration-3's KeyNode 2 is `^https://developer\.mozilla\.org/en-US/docs/Web/JavaScript/?$`, which neither extracted URL (`/` and `/en-US/`) matches. KeyNode 1 `(en-US/?)?$` matches, so actual post-fix count is **1**, not 2. The fix itself is correct and the qualitative gain (0 → non-zero) still holds, but the numeric claim is off. Non-blocking — diary artifact only.
- [INFO] `url-extraction.ts:43-49` uses `!== null` to check `RegExp.exec` return values. CLAUDE.md's "Never Use Null" rule targets authored values, not comparisons against platform-returned nulls. Idiomatic for the built-in regex API; acceptable, though replacing with truthiness checks would be cosmetically closer to the rule's spirit.

## Antagonistic checklist — results

1. **Scope hygiene** — all 4 files and only those files. `git diff --stat` against the banned paths returns empty. `evalite.config.ts` untouched (as required by Wave 4.5 addendum's byte-identical config rule).
2. **Regex fidelity** — all 4 patterns verified against upstream `chrome-devtools-mcp` build sources AND against captured real traces. Not engineer-synthesized.
3. **URL edge cases** — verified `NAVIGATED_PATTERN` and `PAGES_SELECTED_PATTERN` against URLs containing `?q=foo&bar=baz`, `?q=a,b`, and `(paren)/path`. Lazy `\S+?` + `[.\s]*` trailing correctly strips sentence-terminating periods without over-shortening.
4. **Test fixtures realism** — integration tests (#6, #7) pass `rawInput: {}` + `rawOutput: [{type:"text",text:...}]` shapes that route through the real `serializeToolResult`/`AcpToolCallUpdate → ExecutedPerfPlan.applyAcp` pipeline (`packages/shared/src/models.ts:710-725,978-987`). Tests exercise the full production path — NOT a stripped-down fixture. Confirms `isError: update.status === "failed"` (shared/models.ts:986) correctly gates the extraction in test 7.
5. **Integration end-to-end assertion** — test 6 asserts `trace.toolCalls[0].arguments["input"] === "{}"` (proves the F5 "args: {}" case), `reachedKeyNodes.length === 1`, and `finalUrl === "https://example.com/"`. The full input `{}` → tool-result array → extractor → scorer → `ExecutedTrace` flow is exercised.
6. **Error-path negative assertion** — test 7 asserts `reachedKeyNodes.length === 0` AND `finalUrl === ""` when `status: "failed"`. Verified `isError` path skips extractor in `real.ts:197`. Correct.
7. **Backward compat** — `extractUrlFromToolInput` is byte-identical to the prior inline helper. Regression test #5 (`"extractUrlFromToolInput keeps reading pre-Wave-2.A { url } / { action: { url } } shapes"`) locks in old behavior. Test #1 (`"records agent messages..."`) exercises the pre-Wave-2.A `{ action: { command: "navigate", url } }` flow end-to-end.
8. **Effect rules** — `url-extraction.ts` is a pure module (no Effect wrapping). Matches "Pure Functions Stay Pure" rule. No `as`, no authored `null`, no `// HACK`, no unused imports, no defensive error handling. Kebab-case filename. Arrow functions. `interface` not needed here.
9. **Structurally-complete test fakes** — `scriptedAgentLayer` and `gitFake` in `real-runner.test.ts` use `satisfies AgentShape`/`satisfies GitShape`, enforcing injection-seam completeness per project memory `feedback_no_test_only_injection_seams`. Inline comment (lines 144-149) explicitly flags this guard.
10. **Pattern precedence** — NAVIGATED → PAGES_SELECTED → TRACE_URL → ROOT_WEB_AREA. Inspected multi-tool traces (`moderate-1`, `moderate-2`, `calibration-5`); no single tool-result emits both TRACE_URL and ROOT_WEB_AREA markers, so ordering is safe for all observed surfaces.
11. **ROOT_WEB_AREA `_0` restriction** — grepped all traces for `RootWebArea` uid formats. Non-`_0` indexes appear only for nested iframe roots (e.g., `uid=1_25 RootWebArea "Gallery scroll from Figma on Vimeo" url="https://player.vimeo.com/..."` inside `journey-4-account-signup`). Restricting to `_0` correctly isolates the page-level root from iframe sub-roots — not a false-positive source.
12. **Commit plan separability** — the diff is naturally separable into (a) `url-extraction.ts` + `real.ts` wiring, (b) `real-runner.test.ts` additions, (c) diary markdown. Engineer's proposed 2-3 commit split is viable.
13. **No destructive git** — engineer's diary explicitly states no stash/reset/checkout; `git stash list` shows only a pre-existing unrelated stash (`WIP on main: f3b752d4 fix(cli-solid): make insights overlay row selection reactive (FIX-E)`), not the engineer's.
14. **Real-runner timeout acknowledgment** — diary correctly attributes end-to-end evalite score gap to the 30s test timeout (not the extractor), and defers the 180s bump to a future measurement wave per the Wave 4.5 addendum byte-identical-config convention.

## Suggestions (non-blocking)

- Diary fix: update the post-fix table (lines 112-114, 142-144) to reflect the accurate calibration-3 projection of `reachedKeyNodes` = 1 (not 2). The qualitative "0 → non-zero" claim still supports the fix's motivation.
- Consider collapsing `!== null` regex checks to truthiness (`if (navigated) return navigated[1]`) for closer adherence to the Effect no-null spirit. Cosmetic.
- Future hardening (out of scope for this fix): when both `NAVIGATED_PATTERN` and `ROOT_WEB_AREA_PATTERN` match a single payload with different URLs (e.g., mid-navigation snapshot), ROOT_WEB_AREA carries the more recent active URL. Current NAVIGATED-first ordering could be revisited in a future wave if that case materializes — none observed in current trace corpus.

## Exit criteria

- [x] Verification commands pass (tests deterministic 88/88 ×2, typecheck clean, scope contained, pre-existing drift files unchanged).
- [x] No critical/major findings.
- [x] Engineer's diary claims (regex fidelity, fixture realism, byte-identical backport, end-to-end replay) independently verified against upstream chrome-devtools-mcp sources, real traces, and `git show` diffs.
- [x] Sibling-code check: confirmed the F5 sibling pattern (`extractUrlFromToolInput` callers) was preserved on the ToolCall branch, and the new extractor added on the ToolResult branch is symmetric. No twin bug left unfixed.

Code fix is correct, minimal, and production-ready. Approving the merge.
