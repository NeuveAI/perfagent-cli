# Wave 0.B — Eval scaffold diary

## Summary

Greenfield `packages/evals/` added to the workspace with `evalite@1.0.0-beta.16`,
four pure scorers, five hand-authored task fixtures, a scripted mock runner, and
a smoke eval that produces a scored results table per scenario.

## Package layout

```
packages/evals/
  package.json              # name: @neuve/evals, deps: effect, evalite, vitest
  tsconfig.json             # extends root; rootDir "." so src/tasks/evals/tests are all included
  vite.config.ts            # vite-plus test config (globals: true)
  evalite.config.ts         # maxConcurrency 5, testTimeout 30s
  src/
    task.ts                 # KeyNode, PerfBudget, EvalTask, ToolCall, ExecutedTrace (Schema.Class)
    scorers/
      step-coverage.ts      # pure, (reached, expected) => number in [0,1]
      final-state.ts        # pure, (finalUrl, finalDom, expected) => boolean
      tool-call-validity.ts # pure, (calls) => number ratio
      furthest-key-node.ts  # pure, (reached, expected) => index (-1 when none)
    runners/
      mock.ts               # pure, scripted trace builder (success | stops-at-1 | malformed-tools)
  tasks/
    trivial-1.ts            # example.com single-nav
    trivial-2.ts            # wikipedia.org single-nav
    moderate-1.ts           # github.com -> explore -> topics (3 key-nodes, LCP budget)
    moderate-2.ts           # MDN -> Web APIs -> Fetch API (3 key-nodes)
    hard-volvo-ex90.ts      # 6 key-nodes: landing -> Buy -> Build Your Volvo -> EX90 page
                            #              -> configurator -> order-request form
  evals/
    smoke.eval.ts           # runs runMock across all 5 tasks x 3 scenarios = 15 cases
  tests/
    scorers.test.ts         # 17 unit tests across the 4 scorers
    tasks.test.ts           # Schema.Class decoding test per fixture + calibration assertion
    mock-runner.test.ts     # 3 scenario tests: success, stops-at-1, malformed-tools
```

## Domain model notes

- `KeyNode.urlPattern` is a regex source string. The scorers accept both exact
  string equality and regex match on the reached node's `urlPattern`. This means
  fixtures can store the same regex on both expected and mock-reached sides
  without having to synthesize concrete sample URLs. Real runners (later waves)
  will populate `reached.urlPattern` with concrete URLs; the regex test path
  still works for those.
- `PerfBudget` is a `Schema.Class` rather than a `Schema.Struct` so fixture
  authors construct it with `new PerfBudget(...)`. Effect's `Schema.Class`
  parser rejects plain objects for nested class-typed fields.
- `ExpectedFinalState` is a plain `Schema.Struct` — it has no methods and no
  identity beyond its shape, so a class would be overhead.
- `ExecutedTrace` carries the reached key-nodes, the tool calls, and the final
  URL/DOM strings. That's the minimal surface the four scorers need. Real
  agent traces in Wave 3 can extend this or remain compatible at the scorer
  boundary.

## Scorer behavior

All four scorers are **pure functions** (no Effect wrapping) per the CLAUDE.md
rule "pure functions stay pure."

| Scorer              | Returns                             | On empty input    |
| ------------------- | ----------------------------------- | ----------------- |
| step-coverage       | `hits / expected.length` in [0,1]   | 1 (vacuous pass)  |
| final-state         | boolean                             | n/a               |
| tool-call-validity  | `wellFormed / total` in [0,1]       | 1 (vacuous pass)  |
| furthest-key-node   | index in [0, expected.length-1]     | -1 (none reached) |

In `smoke.eval.ts`, `furthest-key-node` is normalized to `[0,1]` as
`(index + 1) / expected.length` so evalite's averaged scoreboard is meaningful.

## Mock runner scenarios

The runner is configurable via a `scenario` flag rather than hard-coded so one
mock covers both positive and negative scoring cases:

- `success` — reaches every expected key-node, all tool calls well-formed,
  final URL+DOM match the expected final state.
- `stops-at-1` — reaches only the first expected key-node, finalDom marked
  "stopped-early" so `final-state` returns false for all tasks.
- `malformed-tools` — reaches every key-node but every tool call has
  `wellFormed: false`, and finalUrl/finalDom are empty so `final-state` fails.

Together these three scenarios give every scorer at least one passing row and
at least one failing row across the 5 tasks.

## DoD verification

1. `pnpm install` succeeds with `@neuve/evals` wired in. `pnpm-workspace.yaml`
   already globs `packages/*` — no edit needed there.
2. `pnpm --filter @neuve/evals test` — 3 files, 25 tests pass.
3. `pnpm --filter @neuve/evals eval` — evalite prints a 15-row scoreboard.
   All `success` rows score 100%; `stops-at-1` and `malformed-tools` rows drop
   to 33%-75% depending on how many scorers penalize each scenario.
4. `pnpm typecheck` repo-wide — 10/10 packages green.

## Deviations from the plan

1. **Added a mock-runner unit test file** (`tests/mock-runner.test.ts`) beyond
   the plan's two required test files. The plan asked for scorer tests and a
   decoding test; the extra file exercises the three scripted scenarios to
   confirm they behave as advertised. Small, self-contained, worth the
   confidence.
2. **Added `ExecutedTrace` and `ToolCall` to `task.ts`** — the plan specified
   only `EvalTask` and `KeyNode`. These two additional `Schema.Class` types
   describe the mock runner output and tool-call shape. Keeping them in
   `task.ts` follows the "consolidate schemas, don't proliferate models" rule —
   every type a scorer consumes lives in one file.
3. **`vitest` as a direct dep** — pnpm workspace overrides `vitest` to
   `@voidzero-dev/vite-plus-test`, but evalite's CLI imports `vitest` by name
   at runtime. Declaring `vitest: ^4.0.18` in `packages/evals/package.json`
   gets the override applied so the CLI can resolve it. No runtime impact on
   other packages.
4. **`keyNodeMatches` accepts equality OR regex match.** The original plan
   implies `urlPattern` is always regex. The mock runner copies the expected
   pattern into `reached.urlPattern` verbatim; literal regexes like
   `^https://www\.volvocars\.com/[a-z-]+/?$` don't match themselves when passed
   through `new RegExp().test()`. Equality short-circuits that case without
   requiring fixtures to invent concrete sample URLs. Real browser traces in
   Wave 3 will populate `reached.urlPattern` with concrete URLs; the regex
   branch still works there.

## Out-of-scope confirmations

- No touch to `packages/supervisor`, `packages/browser`, `packages/agent`,
  `packages/shared`, or any app. The new package has no runtime imports from
  sibling packages.
- No real browser, no real agent, no Online-Mind2Web, no visual grounding — all
  deferred to Waves 1-4 per the plan.
- No barrel `index.ts` files anywhere in the new package.

## Known pre-existing issue (not caused by this wave)

`pnpm --filter <pkg> lint` and `pnpm --filter <pkg> check` both fail on every
package with `Unknown file extension ".ts" for vite.config.ts`. This is a
vite-plus configuration loader issue at the repo root, unchanged from before
this wave. Typecheck and test runners are unaffected.
