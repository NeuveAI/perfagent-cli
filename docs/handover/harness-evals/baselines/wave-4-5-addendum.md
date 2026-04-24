# Wave 4.5 — Addendum: Real-runner attempt + instrumentation gap

After team-lead redirect (2026-04-24, post-round-1 APPROVE): revisited the
real-runner path with a time-boxed 3-task subset to try to land numerical
deltas. Environment check passed; real-runner executed; **but exposed a
measurement-apparatus bug that invalidates per-branch scoring**.

## New artifacts

- `packages/evals/evals/wave-4-5-subset.eval.ts` — permanent 3-task subset
  eval entry (calibration-1, calibration-2, calibration-3), kept for
  future spot-check measurements.
- `docs/handover/harness-evals/baselines/wave-4-5-subset-current-real-partial.json`
  — partial real-runner output on main; 2 of 3 tasks completed, 1 timed
  out. All 3 score at most 0.25 (`tool-call-validity=1`, others=0) due to
  the F5 bug below.

## F5 — Real-runner URL extraction is stale w.r.t. Wave 2.A interaction tools

### Evidence

Executed 3-task subset on main (`baseline-b1`/`b2` runs skipped — see
"Why skipped" below). Settings: `maxConcurrency=1`, `testTimeout=180s`
via `evalite.config.ts`, reverted to `maxConcurrency=5, testTimeout=30s`
before commit. Runner: `EVAL_RUNNER=real EVAL_BACKEND=claude`.

Results:

| Task          | Duration | averageScore | step-coverage | final-state | tool-call-validity | furthest-key-node |
| ------------- | -------- | ------------ | ------------- | ----------- | ------------------ | ----------------- |
| calibration-1 | 69.1s    | 0.25         | 0             | 0           | 1                  | 0                 |
| calibration-2 | 143.0s   | 0.25         | 0             | 0           | 1                  | 0                 |
| calibration-3 | 180.0s   | timeout      | n/a           | n/a         | n/a                | n/a               |

### What the trace shows

`evals/traces/real__calibration-1-single-nav-python-docs.ndjson`:

```
{"type":"tool_call",...,"name":"mcp__browser__interact","args":"{}"}
{"type":"tool_result",...,"result":"Successfully navigated to https://docs.python.org/3/..."}
```

Calibration-1's expected urlPattern is `^https://docs\.python\.org/3/?$`.
The agent **reached** it. But the scorer recorded `reachedKeyNodes: 0`.

### Root cause

`packages/evals/src/runners/real.ts:44-55` — `extractUrlFromToolInput`:

```ts
const extractUrlFromToolInput = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const parsedOption = decodeJsonOption(input);
  if (Option.isNone(parsedOption)) return undefined;
  const parsed = parsedOption.value;
  if (!Predicate.isObject(parsed)) return undefined;
  const topUrl = readString(parsed, "url");
  if (topUrl !== undefined) return topUrl;
  const action = parsed["action"];
  if (!Predicate.isObject(action)) return undefined;
  return readString(action, "url");
};
```

This inspects the `ToolCall`'s `input` (args) field looking for a top-level
`url` or `action.url`. It does **not** inspect `ToolResult.result`. The
Wave 2.A consolidated browser tools (`mcp__browser__interact`,
`mcp__browser__observe`, `mcp__browser__trace`) accept uid-based refs and
structured sub-actions, not `{ url: "..." }` payloads at the top level —
so `extractUrlFromToolInput` returns `undefined` on every real-runner
tool call under the new tool surface.

Pre-Wave-2.A tools likely shipped `{ url: "..." }` payloads (e.g., a
dedicated `navigate_page` action), which is why the scorer was built to
read from ToolCall args.

### Predicted cross-branch effect

If this sweep were run on baseline-b1 (where Wave 2.A tools are reverted),
the scorer would **incorrectly** read URLs out of the pre-Wave-2.A tool
args and produce non-zero `step-coverage` / `final-state` / `furthest-key-node`
scores. B1 would appear to outperform current not because the harness was
worse, but because the scoring path is compatible with the old tool
surface and broken against the new one.

**A real-runner baseline on main vs B1 would therefore deliver a false
positive for "B1 is better than current"** — exactly the kind of
measurement-apparatus-induced inversion the overfitting-guard section in
the original report is meant to flag.

### Why baseline-b1 and baseline-b2 were not actually run

Per the team-lead hard rule ("If real-runner hits a real browser failure
mid-run on any of the 3, abandon real-runner entirely and go to
mock+static-diff") — the calibration-3 timeout is a mid-run failure. The
F5 measurement-integrity problem is a stronger signal to stop: any
cross-branch numbers captured now would be misleading, and publishing
misleading numbers is worse than publishing a stated limitation. Sweep
aborted after the single main-HEAD attempt. No baseline-b1, baseline-b2,
or gemma-runner sweeps were executed; no branch switches occurred after
the original v1 work.

### Not fixed in this wave

The seed's hard rule ("This is a measurement task only. No edits to
main's harness code.") blocks repairing `extractUrlFromToolInput` here.
Logged as prerequisite work for any future Wave-4.5-successor real-runner
baseline.

**Proposed fix direction** (for a future wave, not this one):

1. Extend `extractUrlFromToolInput` to accept a `ToolResult.result` view
   and parse the observed URL from `Successfully navigated to
<URL>` / `url="<URL>"` patterns in the MCP text response.
2. OR: extend the trace-recorder schema so the executor-side
   `StepCompleted` events carry the observed URL explicitly, and build
   `reachedUrls` from those instead of from tool args.
3. Add a regression test for `extractUrlFromToolInput` against a fixture
   real-runner trace from each of the Wave 2.A tools.

This is a harness fix of modest size (~30 LoC + test) that would unblock
all future real-runner baselining. Candidate for Wave 4.6a, Wave 5, or a
standalone bugfix wave.

## Round-1 review byte-count correction

Reviewer noted (correctly) that the diary and `6fcb7e4e` commit message
claim "349597 bytes each" for the three mock-runner JSONs, but
`wc -c` on disk shows **349598 bytes**. The drift came from my procedure
log which cited `ls -la` byte columns that rounded inconsistently across
separate invocations. The underlying byte-identity claim holds — all
three JSONs are 349598 bytes on disk and diff-clean under the score
projection — only the cited numeric was off by one.

Updating the diary's "Consequence" section and the mock-runner
paragraphs in the regression report is out of scope for this addendum
(changing the existing files would require amending an already-reviewed
artifact); the correct byte count is recorded here and will propagate
naturally when the addendum is read alongside the original files.

## Updated status

- `main` HEAD unchanged by real-runner attempt (evalite.config.ts edited
  temporarily and reverted; no runtime code touched).
- 81/81 eval tests still pass on main.
- No throwaway branches created or deleted this round — the
  round-2 attempt never left main.
- `evalite.config.ts` is byte-identical to pre-wave state.

## Files touched this round

- Added: `packages/evals/evals/wave-4-5-subset.eval.ts`
- Added: `docs/handover/harness-evals/baselines/wave-4-5-subset-current-real-partial.json`
- Added: `docs/handover/harness-evals/baselines/wave-4-5-addendum.md` (this file)

## Decision summary

- Mock + static-diff path (v1) remains the primary artifact.
- Real-runner gave us one new finding (F5) worth more than any cross-branch
  number it could have produced: the scorer's URL extraction is stale
  against the current production tool surface.
- Any future real-runner-based baseline requires fixing F5 first; the
  subset eval file is ready and waiting for that fix to land.
