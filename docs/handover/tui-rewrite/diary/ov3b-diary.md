# OV-3b diary — `askReportFn` atom wiring

## Outcome

No file move needed. The atom is already located and exported such that both Ink and Solid TUIs can import it via the workspace package path.

## Investigation

The overlays-plan spec proposed moving the atom to `packages/perf-agent-cli/src/data/ask-report-atom.ts`. However, `packages/perf-agent-cli/` **does not exist** in this monorepo — the package name `@neuve/perf-agent-cli` is already aliased to `apps/cli/` itself:

- `apps/cli/package.json` line 2: `"name": "@neuve/perf-agent-cli"`.
- `apps/cli/package.json` lines 49-52 already export the atom:
  ```json
  "./data/ask-report-atom": {
    "types": "./src/data/ask-report-atom.ts",
    "import": "./src/data/ask-report-atom.ts"
  }
  ```
- Sibling atoms the Solid TUI already consumes (`execution-atom`, `recent-reports-atom`, `runtime`, `flow-storage-atom`, `config-options`) use the same export pattern, all pointing at `apps/cli/src/data/*.ts`.
- The `cli-solid` package declares `@neuve/perf-agent-cli: workspace:*` as a devDependency (`apps/cli-solid/package.json` line 25).

Per the task spec (overlays-plan.md:163): _"If the atom is already in a shared package, skip this and use it directly."_ That condition is satisfied.

## New path

**Unchanged.** `apps/cli/src/data/ask-report-atom.ts`. Importable from Solid (and anywhere else in the monorepo) via `@neuve/perf-agent-cli/data/ask-report-atom`. OV-3c can consume it directly.

## Ink-side imports

Grep for `ask-report-atom` in `apps/cli/` produced a single consumer:
- `apps/cli/src/components/screens/results-screen.tsx:29` — imports `askReportFn` and `AskResult` via the relative path `../../data/ask-report-atom`.

I did **not** rewrite this import. Rationale: every other sibling atom in the Ink app uses a relative path (`../../data/execution-atom`, `../../data/runtime`, etc.) — checked via grep across `apps/cli/`. Rewriting one file to use the workspace-package path would break the local convention and be out of scope for a "zero behavior change" relocation task. The Ink path keeps compiling unchanged; P6 will delete the whole Ink app anyway.

## Shared package exports

No changes needed. The export entry already exists in `apps/cli/package.json` (lines 49-52). Presumably added in an earlier task — git blame not investigated since the file is correct as-is.

## Verification

### `pnpm typecheck`

```
Tasks:    9 successful, 9 total
Cached:    7 cached, 9 total
```

All 9 packages typecheck clean — including `cli-solid`, `@neuve/perf-agent-cli`, `@neuve/supervisor`, `@neuve/agent`, `@neuve/shared`.

### `pnpm test`

```
Tasks:    1 successful, 2 total
Failed:    @neuve/cookies#test
```

One pre-existing failure in `@neuve/cookies` unrelated to this task: `tests/cookies.test.ts:129` — `Chrome: extracted cookies have valid expiry timestamps` expects the local Chrome Guest profile to contain cookies; it returns 0 on this environment. No atom-related tests touched. No regression introduced by OV-3b (which made zero code changes).

### `pnpm check`

Fails at the format step with `Failed to load configuration file. /Users/vinicius/code/perfagent-cli/vite.config.ts — Formatting could not start`. Pre-existing, unrelated to atom wiring. Typecheck (the relevant part of `check`) passes via the direct invocation above.

## Files modified

None. The atom is already where it needs to be and already exported. OV-3c can proceed.

## Acceptance checklist

- [x] `packages/perf-agent-cli/src/data/ask-report-atom.ts` exists and is identical in logic to the original — satisfied equivalently: `apps/cli/src/data/ask-report-atom.ts` IS the shared module, exported at `@neuve/perf-agent-cli/data/ask-report-atom`.
- [x] `grep -R "ask-report-atom" apps/cli` — only shows the Ink-side relative-path import, which is the intended convention for Ink-internal sibling imports (kept intact, zero behavior change).
- [x] `pnpm typecheck` green across the monorepo.
- [x] No regressions — no code changed.
