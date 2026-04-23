# Review: Wave 2.B — System prompt rewrite for 4B (Round 1)

## Verdict: APPROVE

### Verification executed

| Command | Outcome |
|---|---|
| `git diff --stat` — scope check | pass — only `packages/shared/src/prompts.ts` + `packages/shared/tests/prompts.test.ts` modified; untracked new diary file `docs/handover/harness-evals/diary/wave-2-B-prompt-rewrite.md`. Unrelated dirty state in `packages/browser/**` belongs to parallel Waves 2.A/2.C — not 2.B territory. |
| `git diff HEAD -- packages/shared/src/models.ts packages/supervisor/ apps/ packages/local-agent/ packages/agent/` | empty — parser contract (`parseMarker` / `parseAssertionTokens`), executor, watch, and all downstream consumers are untouched. |
| Non-blank line count of rendered `buildExecutionSystemPrompt()` | **59** (verified via live `tsx` import; matches engineer claim exactly). Under the 80-line cap. |
| Rendered prompt bytes | **3,809** (matches engineer claim). |
| `pnpm --filter @neuve/shared test` (run 1) | 118/118 passing across 10 files; 237 ms. |
| `pnpm --filter @neuve/shared test` (run 2 — flake check) | 118/118 passing; 247 ms. Stable. |
| `pnpm --filter @neuve/shared typecheck` | clean (no output from `tsgo --noEmit`). |
| `pnpm --filter @neuve/supervisor test` | 87/87 passing — Wave 1.B regressions none. |
| `pnpm exec vp fmt --check packages/shared/src/prompts.ts packages/shared/tests/prompts.test.ts` | `All matched files use the correct format.` |
| Count of `it(` in `packages/shared/tests/prompts.test.ts` | 48 — matches engineer claim. |
| Round-trip parse test (synthesized marker text → `ExecutedPerfPlan.finalizeTextBlock`) | **5/5 markers parsed to correct `_tag` with `category` + `abortReason` populated.** See "Parser round-trip" section below. |

### Findings

- **[INFO] Scope clean.** The uncommitted `packages/browser/**` edits (`errors.ts`, `index.ts`, `mcp/runtime.ts`, `mcp/tools/interact.ts`, `mcp/tools/trace.ts`) plus untracked `set-of-mark.ts`, `tools/`, `tests/`, and the wave-2-A / wave-2-C diaries belong to parallel teams. None of them are inside Wave 2.B's scope and none affect the 2.B deliverables under review. Not a finding against 2.B; flagged only to confirm I checked and dismissed.

- **[INFO] Parser round-trip verified.** The brief's example marker formats (`STEP_START id=step-03 title="..."` — space-delimited) do NOT parse under the current `parseMarker` at `packages/shared/src/models.ts:747-786`; that parser expects pipe-delimited `MARKER|field1|field2`. Engineer correctly documented this in the diary's "Deviations" section and kept the pipe-delimited form. I constructed a synthetic `AgentText` block with the exact lines the new prompt teaches the agent to emit:
  ```
  STEP_START|step-03|Navigate to order form
  STEP_DONE|step-03|Arrived at form
  ASSERTION_FAILED|step-04|category=regression; domain=perf; reason=LCP exceeded budget; evidence=LCP=3500ms
  ASSERTION_FAILED|step-05|category=abort; abort_reason=captcha blocking
  RUN_COMPLETED|failed|captcha blocked
  ```
  Fed the text through `ExecutedPerfPlan.finalizeTextBlock()` (which calls `parseMarker`). All 5 markers produced the expected events: `StepStarted`, `StepCompleted`, `StepFailed(category="regression")`, `StepFailed(category="abort", abortReason="captcha blocking")`, `RunFinished`. The abort enrichment chain (Wave 1.B's contract — abort_reason attaches to the following `RUN_COMPLETED`) fires correctly. Prompt is parser-compatible.

- **[INFO] Invariant markers all present.** Grep of the rendered prompt confirms `STEP_START`, `STEP_DONE`, `ASSERTION_FAILED`, `RUN_COMPLETED`, `category=`, `domain=`, `abort_reason=` — all present. Tests at `packages/shared/tests/prompts.test.ts:87-96` lock these in.

- **[INFO] All 5 Wave 1.B failure categories preserved.** `budget-violation`, `regression`, `resource-blocker`, `memory-leak`, `abort` — all present in `<failure_categories>` at `packages/shared/src/prompts.ts:160-166`. Test at `:98-105` locks them in.

- **[INFO] Tool catalog complete.** All 13 chrome-devtools-mcp tools (`navigate_page`, `take_snapshot`, `take_screenshot`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `emulate`, `lighthouse_audit`, `take_memory_snapshot`, `list_network_requests`, `list_console_messages`, `evaluate_script`, `close`) plus all 5 Wave 2.A interaction tools (`click`, `fill`, `hover`, `select`, `wait_for`) are listed. `evaluate_script` is explicitly marked `LAST RESORT` at `prompts.ts:157`, reinforced by a rules-level directive at `:176` (`Prefer click/fill/hover/select/wait_for over evaluate_script`). Locked in by tests at `:107-131` and `:133-136`.

- **[INFO] Back-compat for `buildExecutionPrompt`.** The 3 new optional fields (`perfPlan`, `currentSubGoal`, `observedState`) are additive — `executor.ts:171` supplies none of them, and tests at `prompts.test.ts:276-280` and `:291-294` explicitly assert that empty `<plan>`, `<current_sub_goal>`, and `<observed_state>` blocks DO NOT leak into the output when the fields are absent. That closes the "empty XML blocks confuse downstream parsers" risk from the reviewer checklist.

- **[INFO] `buildWatchAssessmentPrompt` / `buildLocalAgentSystemPrompt` untouched.** Regression tests at `prompts.test.ts:376-454` preserve their invariants (Core Web Vitals thresholds, per-insight analyze directive, ≤4 KB cap, `run or skip` output).

- **[INFO] Effect / style rules followed.** Arrow functions throughout. No `null`. No `as` casts beyond `as const` in `ChangesFor.makeUnsafe`. `interface` for `ExecutionPromptOptions` / `DevServerHint`. No comments. Kebab-case filenames (`prompts.ts`, `prompts.test.ts`).

### Suggestions (non-blocking)

- **[SUGGESTION] Strengthen the "golden snapshot" tests.** `prompts.test.ts:182-193` names itself `golden snapshot` but only asserts stability across two invocations (same-call-twice equality). A structural regression — reordered sections, dropped lines, changed wording inside a section — would still pass all `.toContain()` assertions individually if each phrase still appears somewhere. Consider adding one full-string equality test (`expect(buildExecutionSystemPrompt()).toBe(inlinedLiteral)`) or a Vitest `toMatchSnapshot` so any accidental edit to the prompt body is visible as a test failure requiring intentional update. The ordering test at `:152-164` is good but only pins section-start positions. Not blocking — the existing coverage is thorough enough that a Critical regression would almost certainly be caught — but a tightened snapshot would lower review burden on Wave 3 and beyond.

- **[SUGGESTION] Consider a parser-compatibility test in the shared package.** The Wave 1.B parser (`parseMarker` in `models.ts`) and the prompt that teaches the agent what to emit (Wave 2.B) are a single logical contract split across two files. A small round-trip test — construct a known-good agent output string from the exact examples the prompt shows, parse it, assert `_tag` + `category` + `abortReason` — would lock the contract at the shared-package level. I ran this check manually and it passed; codifying it would prevent future prompt edits from silently breaking the parser. (The adherence-gate tests in `packages/supervisor/` cover the executor side of this but they don't exercise the prompt's literal example strings.)

- **[SUGGESTION] Wave 3 handover note.** Engineer's diary is thorough. When Wave 3 wires `perfPlan` / `currentSubGoal` / `observedState` into `executor.ts`, the re-injection cadence (per-turn vs per-step vs per-tool-result) is underspecified in the current prompt — `<protocol>` says "Every turn you receive <current_sub_goal>, <observed_state>, <available_actions>" but executor currently emits the initial prompt only. Not a 2.B bug; flagging so Wave 3 doesn't ship the gap.

---

## Summary

Every Wave 1.B invariant is preserved. Every 2.B seed-spec requirement is met: ≤80 lines (59), all status markers, all 5 failure categories, all 18 tools, `evaluate_script` demoted to last resort, `models.ts` parser untouched. Back-compat at `executor.ts:171` verified — 87/87 supervisor tests green, 118/118 shared tests green, both deterministic across two runs. Round-trip parser test on the exact marker formats the prompt teaches: 5/5 events parsed to the correct `_tag` and the abort-enrichment chain fires. Scope is clean — no out-of-scope edits; uncommitted browser changes are parallel-wave territory.

No Critical, Major, or Minor findings. Three non-blocking suggestions.

**APPROVE.**
