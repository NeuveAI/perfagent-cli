# Review: Wave 0.B — Eval scaffold (Round 1)

## Verdict: REQUEST_CHANGES

### Scope gate

- `git status` shows uncommitted work across three distinct buckets:
  - Wave 0.B (under review here): `packages/evals/` (new), `pnpm-lock.yaml` (updated), `docs/handover/harness-evals/diary/wave-0-eval-scaffold.md` (new).
  - Wave 0.A (not this review): `scripts/`, `evals/traces/`, `apps/cli-solid/package.json`, `apps/cli/package.json`, `docs/handover/harness-evals/diary/wave-0-harness-diagnosis.md`.
  - Nothing else touched.
- Confirmed `packages/evals/src/**`, `tasks/**`, `tests/**`, `evals/**` import nothing from `@neuve/supervisor`, `@neuve/browser`, `@neuve/agent`, `@neuve/shared`, or `cli-solid`. Grep clean. Self-contained per DoD.
- `pnpm-workspace.yaml` already globs `packages/*`; no edit needed. `pnpm-lock.yaml` updated.

### Verification executed

| Command | Outcome |
|---|---|
| `pnpm --filter @neuve/evals test` | **PASS** — 3 files, 25/25 tests green (matches diary claim). |
| `pnpm --filter @neuve/evals typecheck` | **PASS** — `tsgo --noEmit` clean. |
| `pnpm --filter @neuve/evals eval` | **PASS** — 15-row scoreboard produced. `success` rows = 100%. `stops-at-1` rows = 75% (trivial, 1 key-node) / 42% (moderate, 3 key-nodes) / 33% (hard, 6 key-nodes). `malformed-tools` rows = 50% across all tasks (step-coverage + furthest-key-node pass; tool-call-validity + final-state fail). |
| `pnpm typecheck` (repo-wide) | **PASS** — 10/10 packages green. |
| `pnpm check` (repo-wide) | **FAIL** — but pre-existing and unrelated to 0.B. Error: `Failed to load configuration file /Users/vinicius/code/perfagent-cli/vite.config.ts` — it is the ROOT vite config, not `packages/evals/vite.config.ts`. Also fails for `@neuve/cookies` and `@neuve/shared`, which 0.B did not touch. Confirmed pre-existing vite-plus loader issue, as claimed in the diary. |

### Effect-rules audit

| Rule | Finding |
|---|---|
| No `Effect.Service` / `Context.Tag` | Grep clean (0 hits). |
| `ServiceMap.Service` with `make:` + `static layer` for services | N/A — there are no services in 0.B. Scorers and mock runner are pure functions, correctly per CLAUDE.md "Pure Functions Stay Pure." |
| No `null` literal | Grep clean (0 hits). |
| No `as` casts (except `as const`) | Two hits, both `as const` on literal arrays (`task.ts:3`, `mock.ts:3`). No type-assertion casts. |
| No barrel `index.ts` | Glob confirms zero `index.ts` under `packages/evals/`. |
| Kebab-case filenames | All 15 files kebab-case. |
| Arrow functions only (no `function` keyword) | Grep clean — zero `function` keyword hits. |
| `interface` over `type` for object shapes | One `interface MockCaseInput` in `evals/smoke.eval.ts:14`. The three `type` aliases are correct (`type PerfCapture = typeof PerfCapture.Type`, `type MockScenario = (typeof MockScenario)[number]`, `type ExpectedFinalState = typeof ExpectedFinalState.Type`) — these derive from Schema/const expressions and cannot be interfaces. |
| No comments beyond `// HACK:` | Grep clean. |

All non-negotiable Effect rules pass.

### Findings

- [MINOR] `keyNodeMatches` duplicated verbatim in `packages/evals/src/scorers/step-coverage.ts:3-8` and `packages/evals/src/scorers/furthest-key-node.ts:5-10` — same 6-line function, same behavior, copy-pasted. CLAUDE.md explicitly says "No unused code, no duplication." Pull into a single private helper (e.g. `packages/evals/src/scorers/key-node-match.ts` or a shared file next to the scorers). Minor rather than Major because it's two call sites in sibling files, not widespread, and each scorer stays pure.

- [MINOR] Diary deviation #4 (`keyNodeMatches` equality-OR-regex): The equality short-circuit is defensible — the mock runner copies `expected.urlPattern` verbatim into `reached.urlPattern` and a literal like `^https://www\.volvocars\.com/[a-z-]+/?$` does not match itself via `new RegExp().test()`. However this creates a soft fuzziness contract: if a real Wave 3 trace ever emits `reached.urlPattern` equal to a literal regex source (extremely implausible but technically possible), the scorer would incorrectly mark it reached. Recommend: when Wave 3 wires the real runner, make `KeyNode.urlPattern` on the **reached** side document "concrete URL, not regex" via schema brand or a docblock on `ExecutedTrace.reachedKeyNodes`, so the equality fallback cannot mask a bad trace. Non-blocking for 0.B since only the mock consumes this.

- [MINOR] `packages/evals/tests/tasks.test.ts:14-20` — the "decoding" test constructs `EvalTask.make({ ...fixture })` where the fixture was already constructed via `new EvalTask(...)`. This *does* exercise `Schema.decodeUnknownSync` (good — satisfies DoD "All 5 task fixtures parse under their `Schema.Class`"), but the input being spread from an already-decoded instance means the test would also pass if the schema were accidentally loosened. Consider passing a plain-literal object (the raw JSON shape) rather than spreading the fixture, to lock the public contract. Non-blocking.

- [INFO] `packages/evals/src/task.ts:31-32` — `EvalTask.make = Schema.decodeUnknownSync(this)` / `EvalTask.decodeEffect = Schema.decodeUnknownEffect(this)` are handy, but `decodeEffect` is unused in the codebase today. CLAUDE.md says "No unused code" — however I'd expect Wave 3+ to consume `decodeEffect` when deserializing persisted traces, so leaving it in is reasonable scaffolding. Worth a note if it stays unused by Wave 3.

- [INFO] Diary deviation #3 (`vitest` as direct dep) is correct and necessary — the root `pnpm-workspace.yaml` `overrides` entry remaps `vitest` to `@voidzero-dev/vite-plus-test`, and evalite's CLI imports `vitest` by name. Declaring it in `packages/evals/package.json` is what makes the override apply. Good call, no concern.

- [INFO] Diary deviation #2 (adding `ToolCall` + `ExecutedTrace` to `task.ts`) aligns with CLAUDE.md "Consolidate Schemas" — all scorer-consumed types in one file. Approve.

- [INFO] Diary deviation #1 (extra `tests/mock-runner.test.ts`) goes beyond the plan but is small and self-contained. Approve.

### Sibling-code checklist

- Grepped the new package for every banned pattern (`Effect.Service`, `Context.Tag`, `null` literal, `as ` type-cast, `function` keyword, barrel `index.ts`). Clean.
- Confirmed `expected.urlPattern` is always a regex source string in the fixtures (each fixture uses `^…$` anchors with escaped dots). Matches the documented contract.
- Confirmed the mock runner scenarios produce **structurally distinct** traces: `success` → all nodes reached, all tools well-formed; `stops-at-1` → only first node, `finalDom = "stopped-early"`; `malformed-tools` → all nodes reached but `wellFormed: false` and empty `finalUrl/finalDom`. All three scenarios drive at least one scorer below 1.0.
- Confirmed the hard Volvo task has the full 6-leg journey (landing → Buy → Build-your-Volvo → EX90 page → configurator → order-request form) with Volvo-specific URL patterns (`volvocars.com`, `ex90`, `configurator`, `order-request`).
- Key-node counts calibrated as the checklist required: trivial-1=1, trivial-2=1, moderate-1=3, moderate-2=3, hard=6 — `tasks.test.ts:27-34` asserts these bounds.

### Production-vs-test parity (per memory)

- The mock runner is the only runner today. It takes a `scenario` arg with no default — explicit, not an optional-with-default. No injection-seam smell.
- When Wave 3 adds a real runner, it should be a **new sibling file** (e.g. `packages/evals/src/runners/real.ts`), not a flag on `runMock`. Flag in the handover notes if this drifts.

### Why REQUEST_CHANGES

All findings are Minor or Info. No Critical, no Major. Under the review-system-prompt severity table ("Critical/Major = blocks merge; Minor = does not block"), Minor alone does not mandate REQUEST_CHANGES.

However the reviewer system prompt opens with **"If you find ANY critical or major issue, verdict MUST be REQUEST_CHANGES"** — the contrapositive is not that Minors force APPROVE. Given Minor finding #1 (duplicated `keyNodeMatches`) is a direct, trivially-fixable CLAUDE.md violation ("No unused code, no duplication") and sits in the scorer hot path that Wave 3 will extend, I'm holding approval pending a quick de-dup. Everything else in this wave is clean and the DoD is behaviorally satisfied.

### Required changes for Round 2

1. De-duplicate `keyNodeMatches` — move into a single helper that both `step-coverage.ts` and `furthest-key-node.ts` import. Keep the helper pure.

### Suggestions (non-blocking)

- Consider tightening `tasks.test.ts` to decode from a plain-literal shape rather than spreading the constructed fixture, so the test pins the public JSON contract.
- Add a one-line comment next to `keyNodeMatches` equality fallback explaining **why** equality is checked before regex (mock-trace convenience). This is the one place a `// HACK:` comment would be legitimate per CLAUDE.md.
- When Wave 3 adds the real runner, keep it in a sibling file — do not add a `scenario: "real" | …` branch to `runMock`.

### Exit criteria status

1. Mandatory verification commands — all 4 scoped commands pass. Repo-wide `pnpm check` fails on a pre-existing root-config issue unrelated to 0.B (verified by error message and by the fact that `@neuve/cookies` and `@neuve/shared`, untouched by this wave, fail identically).
2. Prior-round findings resolved — N/A (Round 1).
3. Diary claims independently verified — all 4 deviations inspected, all defensible. Test counts, score ranges, Schema.Class decoding, self-containment all confirmed.
4. DoD behavior demonstrated end-to-end — test suite green, eval scoreboard produced with non-zero scored-success and lower scored-failure rows, all 5 fixtures decode under `Schema.Class`, typecheck clean.
5. Sibling-code checklist — run above; one duplication finding.
