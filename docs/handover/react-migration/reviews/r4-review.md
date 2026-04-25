# Review: R4 — trajectory rolling + thought-channel strip + budget monitor

## Verdict: APPROVE

R4 ships clean. Engineer's batch delivery looked suspicious given the wave's
2–3 day estimate, but the verification trail holds up: the live tool-loop
integration test demonstrates the rolled view actually reaches Gemma, the
budget-exceeded signal flows end-to-end through `evaluateBudget` →
`logReducerSignal` → synthesized abort `RunFinished` → adherence gate, and
all four banned-pattern grepps come back empty for new code. T5's synthetic
calibration is narrow (only the rolling pipeline, no budget integration in
the same test), but the executor-react-mode integration suite picks up the
budget end-to-end coverage the lead was concerned about.

### Findings

- [INFO] `<|channel>` / `<channel|>` delimiter pair (`packages/shared/src/strip-thought-channel.ts:28-29`) matches the PRD §R4 line 269 example verbatim. Whether real Gemma 4 emits this exact asymmetric form (vs. symmetric `<|channel|>`) is a model-behavior question outside R4's compliance scope; the PRD is binding for this wave. If post-merge runtime data shows a different form, that becomes a follow-up correction, not an R4 blocker.
- [MINOR] `logReducerSignal` in `packages/supervisor/src/executor.ts:130-134` handles `BudgetExceeded` by **fall-through** (no explicit `if (signal._tag === "BudgetExceeded")` check). Today's union has 5 variants and a 4-arm if-else chain plus tail emits the budget warning; if a 6th variant is added, the new variant will silently route through the budget-warning branch with mismatched annotations. Recommend pinning the BudgetExceeded branch behind an explicit tag check (no behavior change today). Non-blocking.
- [MINOR] Two of the three added `packages/shared/package.json` subpath exports are unused by external consumers: `./constants` (no consumer found) and `./strip-thought-channel` (only used internally by `trajectory.ts` via relative import). Only `./trajectory` is actually imported (`packages/local-agent/src/tool-loop.ts:15`). The R4-T3 diary justified `./constants` with "R4-T4 will reuse the supervisor-side constants pattern" but R4-T4 ended up using its own `packages/supervisor/src/constants.ts`. Not harmful (subpath exports are inert if unused), but dead config and the diary's justification didn't materialize. Non-blocking.
- [INFO] `Stream.mapError` at `packages/supervisor/src/executor.ts:473` is technically banned per CLAUDE.md, but it is pre-existing R3 code (verified via `git diff HEAD`) and out of R4 scope. Leaving it for a future R-wave to address.
- [INFO] R4 diary T5 says "4 synthetic-scale calibration tests" but `packages/shared/tests/trajectory-calibration.test.ts` has 5 tests (extra: 100-turn bounded-envelope test at line 149). The actual count of new tests in shared package matches the +34 delta the diary claims (10 + 19 + 5 = 34). Cosmetic mismatch.
- [INFO] Pre-existing barrel `packages/shared/src/index.ts` (mapped via `.` export) is not consumed anywhere via `from "@neuve/shared"`. Pre-existing tech debt, not R4's concern; mentioned for completeness so future cleanup can pick it up.

### Suggestions (non-blocking)

- Pin the `BudgetExceeded` branch with an explicit `if (signal._tag === "BudgetExceeded")` check in `logReducerSignal` to lock down the closed-union dispatch. One-line change.
- Drop the `./constants` and `./strip-thought-channel` subpath exports from `packages/shared/package.json` if no consumer materializes (or delete them when dead). Pure config hygiene.
- Optionally add ONE smoke test that combines `rollTrajectory` + `evaluateBudget` to assert "rolling keeps prompt below the warn threshold across N turns" — would close the loop between T3 and T4 in a single assertion. Currently the calibration probe (rolling-only) and executor-react budget integration (budget-only) both pass independently; the connecting claim ("rolling is what KEEPS us under the warn threshold in production") is implied but not explicitly tested. Non-blocking — the underlying mechanism is correct.

### DoD interpretation rulings

- **Trajectory rolling correctness:** PASS. `rollTrajectory` (`packages/shared/src/trajectory.ts:169`) keeps last N=10 verbatim, summarizes older into a single `<trajectory_summary>` user-message, preserves preface (system + initial user) and trailing dangling messages. 19 tests pin every edge case (0/10/11/13/15 turns; default vs. explicit window; preface preservation; trailing dangling assistant; no-assistant input). Pure function — input array is structurally unchanged (the function returns a fresh `messages` array assembled from slices of the input). No regex; uses `indexOf` + `slice` only. Per-tag summarizer covers all 6 AgentTurn variants.
- **Strip-thought-channel correctness:** PASS. `stripThoughtChannel` (`packages/shared/src/strip-thought-channel.ts:31`) implements the PRD's literal `<|channel>` / `<channel|>` delimiter pair via single-pass `indexOf`+`slice`. 10 tests cover: no-op (no delimiter), empty input, single block, mid-message block, consecutive/non-consecutive blocks, dangling open (drops to end), dangling close (preserved as literal), empty block, bare-open-at-end. No regex. Pure.
- **T3 location deviation (tool-loop vs prompts.ts):** APPROVE WITH RATIONALE. The PRD §R4 line 259 nominally puts `<trajectory>` block in `buildExecutionPrompt`, but `prompts.ts` produces the INITIAL prompt assembled BEFORE the tool-loop spawns; the live trajectory mutation happens inside the agent's `runToolLoop`. Re-prompting from the supervisor every turn would be a different and far more invasive architecture. The engineer's solution synthesizes a `<trajectory_summary>...</trajectory_summary>` user-role message at the chat-call boundary — convergent with the PRD's behavioral intent (the model sees the last 10 turns verbatim + older turns summarized). Verified against runtime behavior:
  - `packages/local-agent/src/tool-loop.ts:115-127` — `rollTrajectory(messages)` is called BEFORE every `ollamaClient.chat(...)`; `messages: rolled.messages` is passed to Ollama (line 127), NOT the raw history.
  - `packages/local-agent/tests/tool-loop-trajectory.test.ts:165-201` — late-round (round 12) chat call `requests[12].options.messages[2]` is asserted to start with `<trajectory_summary>` and end with `</trajectory_summary>`, with exactly 2 summarized event lines + 20 verbatim tail messages.
  - Same test lines 217-221 — the caller's full `messages` array length grows beyond the rolled-view length, confirming the engineer's claim that full history is retained for the supervisor/replay caller.
  - Per-envelope `extNotification("_neuve/agent_turn", ...)` at line 208-218 still fires before the display-side update, so the supervisor's reducer continues to see all AgentTurn events (rolling does NOT skip the supervisor wire).
- **BudgetExceeded signal flow:** PASS. Pure `evaluateBudget` (`packages/supervisor/src/budget-monitor.ts:28`) returns `{signals, runState, shouldAbort}` with warn-once guard via `runState.budgetExceeded`; abort threshold ALWAYS emits regardless of warn state (correct — abort is structural). Executor (`packages/supervisor/src/executor.ts:406-421`) routes `usage_update` through `evaluateBudget`, logs each signal via `logReducerSignal`, and on `shouldAbort` synthesizes `RunFinished({status:"failed", summary:"Context budget exceeded: …", abort:{reason:"context-budget-exceeded"}})`. Adherence gate (`runFinishedSatisfiesGate` line 200) accepts any RunFinished with `abort !== undefined` — verified. `Stream.takeUntil` halts the stream as soon as the synthesized RunFinished arrives (line 472). 9 unit tests in `budget-monitor.test.ts` cover threshold edges (below/at/above warn; warn-once guard; at/above abort; runState identity; flag flip; preserved fields). 3 integration tests in `executor-react-mode.test.ts` cover the executor-side flow (warn-once across 3 usage_updates; abort synthesizes RunFinished and halts stream; abort flows through gate even with intervening unresolved StepFailed).
- **T5 synthetic-calibration:** APPROVE. The calibration probe (`packages/shared/tests/trajectory-calibration.test.ts`) is intentionally narrow — it tests `rollTrajectory` bounds (60-turn / 100-turn / 250-turn rolled prompts stay <96K, ≥40% reduction at 60 turns, monotonicity, summary line char limit). It does NOT integrate with `evaluateBudget` or the executor in the same test. **However**, the lead's preference was "APPROVE if synthetic exercises the integration end-to-end (mocked TokenUsageBus + reducer + executor + adherence gate)" — and that integration is covered by `executor-react-mode.test.ts` budget-warn / budget-abort / budget-abort-flows-through-adherence-gate tests with a scripted Agent stream. The narrow calibration probe + the broad executor integration together meet the DoD. R3's lesson ("live integration catches architectural bugs") is honored by the executor-mode integration test, even though the calibration probe is synthetic.

### Verification log

- **Test runs:**
  - `pnpm --filter @neuve/shared test` → **231 passed (15 files)**, was 197 before R4. Δ=+34 (10 strip-thought-channel + 19 trajectory + 5 trajectory-calibration; engineer's diary said "4 calibration" but file has 5 — counts add up to +34).
  - `pnpm --filter @neuve/local-agent test` → **24 passed (4 files)**, was 22 before R4. Δ=+2 (2 tool-loop-trajectory).
  - `pnpm --filter @neuve/supervisor test` → **134 passed (14 files)**, was 122 before R4. Δ=+12 (9 budget-monitor + 3 executor-react-mode budget tests).
- **Typecheck:**
  - Top-level `pnpm typecheck` reports turbo cascade failure due to pre-existing `@neuve/sdk` Playwright module-not-found (matches R3 grandfathered failure).
  - Per-package individual typechecks: `@neuve/shared`, `@neuve/local-agent`, `@neuve/supervisor`, `@neuve/agent`, `@neuve/cookies`, `@neuve/evals`, `@neuve/perf-agent-cli`, `cli-solid` ALL green individually.
- **Build:** `pnpm --filter @neuve/local-agent build` → `dist/main.js` 45.09 kB (was ~45.04 kB pre-R4; +50 bytes for `rollTrajectory` import + log-line extension). Diary claim matches.
- **Grep results:**
  - Regex ban: `grep -nE "RegExp|new RegExp|\.match\(|/[^/].*?/[gimuy]*\.test\(|\.replace\("` against new files → ZERO matches.
  - Null ban: `grep -nE "\bnull\b"` against new files (excluding comment lines) → ZERO matches.
  - Banned Effect ops: `grep -nE "Effect\.(catchAll|mapError|orElseSucceed|option|ignore)\b"` against new + modified R4 files → ZERO matches in NEW code. (Pre-existing `Stream.mapError` at `executor.ts:473` is R3 code per `git diff HEAD`.)
  - try/catch ban: `grep -nE "\btry\s*\{|\bcatch\s*\("` against new + modified R4 files → ZERO matches.
- **Subpath-export verification:** 3 new exports in `packages/shared/package.json:22-24` each map to a source `.ts` file (`./src/trajectory.ts`, `./src/strip-thought-channel.ts`, `./src/constants.ts`) — NOT a barrel `index.ts`. Per CLAUDE.md "No Barrel Files", correct.
- **T3 actual-prompt-delivery verification:**
  - `packages/local-agent/src/tool-loop.ts:115` → `rollTrajectory(messages)` called every iteration.
  - Line 127 → `messages: rolled.messages` passed to Ollama (rolled view).
  - Line 166 → `messages.push({role:"assistant", ...})` appends to caller's array (full history retained).
  - Test assertion at `packages/local-agent/tests/tool-loop-trajectory.test.ts:174-181` confirms summary block format on round 12.
  - Test assertion at lines 217-221 confirms `messages.length > lateRequest.length` (full history > rolled view).
- **Stash check:** `git stash list` → empty. R3 reviewer's stash mistake was NOT repeated.
- **Git status spot check:** Modified files match the engineer's R4 surface (8 modified + 9 new). Pre-existing untracked Q9 probe files and earlier R-wave diary unchanged.

### Process notes

- Engineer batch-delivered all 5 tasks in one round vs. the wave's nominal 2–3 day pacing. Verification trail (per-task diary + per-task verification commands) holds up — no signs of corner-cutting.
- R3's "live integration catches architectural bugs" lesson is partially honored: T3 has a real `runToolLoop` integration test with a scripted Ollama client that exercises the full chat-history mutation. T4 has executor-stream integration via the existing R3 fixture pattern. Both tests would have caught regressions like the R3 `sessionUpdate as never` cast or sticky `inReactMode` flag.
- No PRD edits proposed; the T3 location deviation is documented in the diary § "Decisions made under ambiguity" item 1, with a clear architectural justification that the PRD's literal placement is incompatible with the agent-loop boundary.
