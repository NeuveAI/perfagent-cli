# Review: Wave 0.A — Baseline harness capture + replay (Round 1)

## Verdict: APPROVE

Scope gate holds: no runtime code was edited. All DoD behavior is reproducible, all diary citations are accurate, and replay is byte-equivalent. One Minor finding (schema drift between the capture script and the `evals/traces/README.md` schema doc) and two Info notes are recorded below; none block merge.

### Verification executed

- `git diff --stat` → `apps/cli/package.json`, `apps/cli-solid/package.json`, `pnpm-lock.yaml` modified. Untracked: `docs/handover/harness-evals/` (plan + review-system-prompt + diary), `evals/traces/`, `packages/evals/` (scope of 0.B — not 0.A), `scripts/capture-harness-trace.ts`, `scripts/replay-harness-trace.ts`.
- `git diff packages/supervisor/src/executor.ts packages/shared/src/prompts.ts packages/shared/src/models.ts` → empty. Runtime files pristine. ✓
- `git diff --stat packages/` → empty (no runtime package edits; `packages/evals/` is untracked, belongs to parallel 0.B task, out of 0.A scope).
- `wc -l evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson` → 14 lines.
- Per-line `JSON.parse` over all 14 lines → 0 malformed.
- Event-type tally: `agent_message=2, tool_call=5, tool_result=5, status_marker=1, stream_terminated=1`. Matches diary claim exactly.
- `pnpm tsx scripts/replay-harness-trace.ts evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson > /tmp/replay-1.out` (exit 0). Re-run → `/tmp/replay-2.out` (exit 0).
- `diff /tmp/replay-1.out /tmp/replay-2.out` → 0 bytes.
- `diff /tmp/replay-1.out evals/traces/2026-04-23T16-17-55Z-volvo-ex90-failure.ndjson` → 0 bytes. Replay is byte-equivalent to source on two consecutive runs. ✓
- `pnpm --filter @neuve/perf-agent-cli typecheck` → `tsgo --noEmit` exit 0. ✓
- `pnpm --filter cli-solid typecheck` → `tsgo --noEmit` exit 0. ✓
- `pnpm check` → fails in `@neuve/shared`, `@neuve/cookies`, `@neuve/evals` with `Failed to load configuration file. /Users/vinicius/code/perfagent-cli/vite.config.ts / Ensure the file has a valid default export of a JSON-serializable configuration object.` `@neuve/shared` and `@neuve/cookies` are **untouched** on this branch (`git status` confirms), so the failure is pre-existing to vite-plus, not introduced by 0.A. Documented as INFO below.
- Diary citation spot-checks:
  - `executor.ts:238` → `Stream.takeUntil((executed) => executed.hasRunFinished),` ✓
  - `models.ts:1082-1084` → `get hasRunFinished(): boolean { return this.events.some((event) => event._tag === "RunFinished"); }` ✓
  - `prompts.ts:146` → `"- First profile the primary route the developer asked about. Measure it thoroughly before moving on."` ✓
  - `prompts.ts:147` → `"- Once the primary route is profiled, analyze additional related routes suggested by the changed files and diff semantics..."` ✓
  - `prompts.ts:151` → `"- Create your own step structure while executing. Use stable sequential IDs like step-01, step-02, step-03."` ✓
  - `prompts.ts:270-278` → `<run_completion>` checklist (items 1-6 + "Do not emit RUN_COMPLETED until all steps above are done.") ✓
- Env-var gating: `rg PERF_AGENT_TRACE_CAPTURE` returns only hits in `scripts/capture-harness-trace.ts` (lines 65, 102). No runtime package reads the env var. Zero behavior change when unset. ✓
- Sibling parity: both `apps/cli/package.json` and `apps/cli-solid/package.json` invoke `bun run ../../scripts/capture-harness-trace.ts` — identical. ✓
- Runtime bypass check: `runFromReport` (scripts/capture-harness-trace.ts:210-246) reads `.perf-agent/reports/<file>.json` with `fs.readFileSync` + `JSON.parse` and writes an ndjson file — no import or call into `executor.ts` beyond type-only. The live path uses `Executor` via `@neuve/sdk.layerSdk` but only taps the stream with `Stream.tap` — does not mutate events. ✓
- DoD-required content in trace file:
  - ≥1 `agent_message` per turn → 2 turns, 2 messages. ✓
  - `tool_call`+`tool_result` pair per tool invocation → 5 calls, 5 results, ids `tc-000`..`tc-004` properly paired. ✓
  - One terminal `stream_terminated` event → event 14 present with `reason` and `remainingSteps` fields. ✓
- Planned-but-unexecuted steps list (diary lines 109-122) → 10-row table. Step #1 marked "reached (but both runs hit 'Access Denied' edge page first and had to reload)"; steps #2-10 marked "not attempted" / "not captured" / "partial". This is concrete and diffable against a future adherence gate, not hand-wavy. ✓

### Findings

- **[MINOR]** `evals/traces/README.md:10` — the `status_marker.marker` union is documented as `"STEP_START"|"STEP_DONE"|"ASSERTION_FAILED"|"RUN_COMPLETED"`, but `scripts/capture-harness-trace.ts:36` lists `STEP_SKIPPED` inside `STATUS_PREFIXES` and the capture code at `scripts/capture-harness-trace.ts:170, 172` emits `status_marker` events with `marker: "STEP_SKIPPED"` when the agent writes that prefix. Schema doc does not include `STEP_SKIPPED`. The committed trace happens to contain no `STEP_SKIPPED` event (verified — tally above), so no data violation yet, but a future capture would produce events that do not match the declared union. Recommendation: add `"STEP_SKIPPED"` to the README schema line, or remove it from `STATUS_PREFIXES` in the capture script. Non-blocking because the one captured trace conforms.

### Info (non-blocking)

- **[INFO]** `pnpm check` is broken repo-wide due to a pre-existing `vite.config.ts` loader issue in vite-plus ("Failed to load configuration file. Ensure the file has a valid default export of a JSON-serializable configuration object."). `packages/cookies` and `packages/shared` — both untouched on this branch — fail identically, confirming the error predates Wave 0.A. Engineer's diary caveat (line 166-167) is accurate. The per-package `tsgo --noEmit` typecheck used as a substitute passes cleanly on both modified apps. No action required from 0.A.
- **[INFO]** `scripts/capture-harness-trace.ts` uses `bun` at the pnpm-script shebang while `scripts/replay-harness-trace.ts` is pure Node built-ins and runs under `pnpm tsx`. DoD command `pnpm tsx scripts/replay-harness-trace.ts evals/traces/<file>.ndjson` was executed during verification and succeeds. Diary caveat (line 167-168) that the live-capture path depends on `bun` because of `node-machine-id` UMD resolution is a known, bounded limitation — only relevant for `--from-report` / live capture, not for the DoD replay path.

### Suggestions (non-blocking)

- Consider committing a minimal unit test under `scripts/` or alongside the future `packages/evals/` that asserts `capture --from-report <fixture>.json` + `replay <output>.ndjson` produces byte-equivalent output — locks in the byte-equivalence guarantee against silent regressions when 1.A/1.B edit `executor.ts`.
- The `runFromReport` path synthesizes monotonic timestamps via `baseTs = Date.now() - events.length * 250` (capture-harness-trace.ts:227). The per-invocation base means two `--from-report` runs produce traces with different absolute `ts` values; the committed trace is byte-stable only because the engineer captured it once and checked the file in. If the replay DoD evolves to "re-run capture and diff," consider a `--deterministic-ts` flag that seeds `ts` from the report's own timestamps.
- The schema doc (`evals/traces/README.md`) would benefit from an explicit note that `tool_call.id` is locally synthesized by the capture script (format `tc-NNN`, zero-padded), not read from the agent event. Consumers downstream in 0.B may reasonably assume `id` is agent-provided.

### Exit criteria check

1. All mandatory verification commands pass (modulo the pre-existing `pnpm check` breakage, which is explicitly not a 0.A regression). ✓
2. No unresolved Critical/Major findings. ✓
3. Diary claims independently verified via direct file reads — not taken on faith. ✓
4. DoD behavior demonstrated end-to-end: trace file exists, parses, contains required event shapes, replays byte-equivalently across two runs. ✓
5. Sibling-code checklist run: no sibling of the problem exists because no runtime code was changed; the two package.json entries are identical; env var is read only inside the standalone script. ✓
