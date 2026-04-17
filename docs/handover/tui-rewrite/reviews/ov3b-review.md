# Review: OV-3b — askReportFn atom relocation

## Verdict: APPROVE

The engineer's "no-op" claim is verified end-to-end. I reproduced every assertion in their diary with direct evidence, including a probe import from `apps/cli-solid/src/tui.ts` that resolves and typechecks cleanly through the workspace package path.

### Evidence collected

1. **Atom exists and exports `askReportFn`.** `apps/cli/src/data/ask-report-atom.ts:220` — `export const askReportFn = cliAtomRuntime.fn(...)`. Also exports `AskResult` type at line 215.

2. **Package export is wired.** `apps/cli/package.json:49-52`:
   ```json
   "./data/ask-report-atom": {
     "types": "./src/data/ask-report-atom.ts",
     "import": "./src/data/ask-report-atom.ts"
   }
   ```

3. **Package name matches the Solid import path.** `apps/cli/package.json:2` — `"name": "@neuve/perf-agent-cli"`. So `@neuve/perf-agent-cli/data/ask-report-atom` resolves to `apps/cli/src/data/ask-report-atom.ts`.

4. **Solid consumes the package as a workspace dep.** `apps/cli-solid/package.json:25` — `"@neuve/perf-agent-cli": "workspace:*"` (devDependencies). The identical pattern is used for 6 already-working imports (e.g. `apps/cli-solid/src/context/runtime.tsx:5,7`, `src/app.tsx:15`, `src/routes/results/results-screen.tsx:5`, `src/routes/testing/testing-screen.tsx:12-13`, `src/context/agent.tsx:4`).

5. **Probe import compiles.** I added at the top of `apps/cli-solid/src/tui.ts`:
   ```ts
   import { askReportFn } from "@neuve/perf-agent-cli/data/ask-report-atom";
   void askReportFn;
   ```
   Ran `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — zero errors. Reverted the probe; `git diff apps/cli-solid/src/tui.ts` now empty. Re-ran both `cli-solid` and `cli` typechecks post-revert — both green.

6. **Atom's transitive deps do not leak Ink.** Its imports are `effect`, `effect/unstable/reactivity/Atom`, `@neuve/agent`, `@neuve/supervisor`, `@neuve/shared/models`, `@effect/platform-node/NodeServices`, and `./runtime` (sibling in `apps/cli/src/data/`). `runtime.ts` imports `../layers` which is still inside `apps/cli/` but `apps/cli/` IS the `@neuve/perf-agent-cli` package — resolution stays inside a single workspace package. No Ink (`ink`, `react`) imports; no cross-app paths. The plan's risk #5 ("atom tightly coupled to Ink-specific layers") does not materialize.

7. **Ink consumers inventoried.** Grep for `ask-report-atom` inside `apps/cli/` yields exactly one consumer — `apps/cli/src/components/screens/results-screen.tsx:29` — matching the diary.

### Findings

- [INFO] The spec in `overlays-plan.md:155-167` proposed moving the atom to `packages/perf-agent-cli/src/data/ask-report-atom.ts`. That target directory does not exist (`ls packages/` shows `agent, browser, cookies, local-agent, perf-agent-skill, shared, supervisor, typescript-sdk`). The spec escape hatch "If the atom is already in a shared package, skip this and use it directly" (line 163) is correctly invoked.

- [INFO] The engineer left the Ink-side consumer importing via relative path (`../../data/ask-report-atom`). That is consistent with every other Ink-internal sibling atom import and avoids churn before the P6 Ink deletion. Acceptable.

- [INFO] `apps/cli/package.json` advertises source TS (`./src/data/ask-report-atom.ts`) in both `types` and `import` conditions — no `./dist/*.js`. This works here because consumers run TS directly (Bun / tsgo), but it is unusual for a published package. Out of scope for OV-3b; flagged only for awareness.

### Suggestions (non-blocking)

- Update `docs/handover/tui-rewrite/overlays-plan.md:160` to reflect reality (the atom lives in `apps/cli/src/data/` and is already exported) so future readers don't chase the phantom `packages/perf-agent-cli/` path. Can be done as part of OV-3c's commit.

- Consider renaming the completed task title "OV-3b: Relocate askReportFn atom to shared package" to "OV-3b: Confirm askReportFn atom is already exported" to match what actually happened — not blocking.

### Verification commands

```bash
bunx tsc --noEmit -p apps/cli-solid/tsconfig.json   # clean, both before and after probe revert
bunx tsc --noEmit -p apps/cli/tsconfig.json         # clean
```
