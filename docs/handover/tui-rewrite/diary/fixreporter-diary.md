# FIX-Reporter — Populate insightSetId for auto-drill synthetic tool calls

Task: #22
Status: ready for review
Engineer: fixreporter-engineer

## Root-cause confirmation

`insightDetails[].insightSetId` was `null` for every entry in `.perf-agent/reports/latest.json`. The auto-drill in `packages/local-agent/src/tool-loop.ts:221-246` emits a synthetic ACP `tool_call` whose `rawInput` is wrapped:

```ts
const analyzeArgs = {
  action: {
    command: "analyze" as const,
    insightSetId: target.insightSetId,
    insightName: target.insightName,
  },
};
```

That `rawInput` is then serialized by `ExecutedPerfPlan.applyUpdate` (`packages/shared/src/models.ts:913-924`) into `ToolCall.input` as `JSON.stringify({ action: {...} })`.

The previous reporter at `packages/supervisor/src/reporter.ts` only understood the TOP-LEVEL shape (the capable-remote-agent convention) — here is the pre-fix function verbatim:

```ts
const extractInsightSetId = (input: unknown, insightName: string): string | undefined => {
  const decoded = decodeToolCallInput(input);
  if (!decoded) return undefined;
  const candidateName = decoded["insightName"];
  if (typeof candidateName !== "string" || candidateName !== insightName) return undefined;
  const insightSetId = decoded["insightSetId"];
  return typeof insightSetId === "string" && insightSetId.length > 0 ? insightSetId : undefined;
};
```

For every auto-drilled insight this returned `undefined`, so `findPrecedingInsightSetId` returned `undefined`, and `InsightDetail.insightSetId` ended up `Option.none()`.

## Implementation diff

`packages/supervisor/src/reporter.ts` — factored the match logic into a helper, then fall through to the wrapped `action` shape when the top-level shape doesn't match:

```ts
const matchInsightSetId = (
  candidate: Record<string, unknown>,
  insightName: string,
): string | undefined => {
  const candidateName = candidate["insightName"];
  if (typeof candidateName !== "string" || candidateName !== insightName) return undefined;
  const insightSetId = candidate["insightSetId"];
  return typeof insightSetId === "string" && insightSetId.length > 0 ? insightSetId : undefined;
};

const extractInsightSetId = (input: unknown, insightName: string): string | undefined => {
  const decoded = decodeToolCallInput(input);
  if (!decoded) return undefined;
  const topLevel = matchInsightSetId(decoded, insightName);
  if (topLevel) return topLevel;
  const action = decoded["action"];
  if (Predicate.isObject(action)) {
    return matchInsightSetId(action as Record<string, unknown>, insightName);
  }
  return undefined;
};
```

Notes:
- Preserves the existing top-level behaviour so capable-remote-agent (Claude/Codex) paths are unaffected.
- Uses `Predicate.isObject` which is already imported and used elsewhere in the file — consistent with file style.
- One narrow `as Record<string, unknown>` cast because `Predicate.isObject` narrows to a `Record<PropertyKey, unknown>`-compatible type. No `as` on the outer API. (Same pattern already in use at `decodeToolCallInput`.)

## New tests

Added to `packages/supervisor/tests/reporter.test.ts`:

1. **Wrapped shape** — `resolves insightSetId when auto-drill wraps input under 'action'`: preceding `ToolCall` has `JSON.stringify({ action: { command: "analyze", insightSetId: "NAVIGATION_0", insightName: "LCPBreakdown" } })`, asserts `insightSetId === "NAVIGATION_0"`.
2. **Missing setId** — `falls back to none when no preceding ToolCall carries insightSetId`: wrapped input with only `insightName`, asserts `Option.isNone(insightSetId) === true`.
3. **Multi-trace coverage** — `populates insightSetId for every entry across multi-trace auto-drill`: two navigations each followed by a wrapped drill call; asserts the two insight details receive `NAVIGATION_0` and `NAVIGATION_1` respectively (this is the exact shape produced by the auto-drill path for two trace runs).

The existing top-level test at line 166 (`captures console, network, and insight detail...`) continues to pass and now functions as the "flat shape still works" regression guard.

## Verification output

`bunx tsc --noEmit` (supervisor package):

```
(clean — no output)
```

`pnpm --filter @neuve/supervisor test`:

```
Test Files  9 passed (9)
     Tests  71 passed (71)
  Start at  20:33:20
  Duration  1.55s
```

Repo-wide `pnpm test`:

- `@neuve/supervisor` — pass.
- `@neuve/cookies` — 1 pre-existing unrelated failure (`Chrome: extracted cookies have valid expiry timestamps` — environment-dependent, also fails on clean `main` without my change, verified via `git stash` + re-run).

Repo-wide `pnpm -r typecheck`:

- `@neuve/supervisor` — clean.
- `@neuve/sdk` — 2 pre-existing `Cannot find module 'playwright'` errors, unrelated to this task.

## Acceptance checklist

1. `bunx tsc --noEmit` clean for supervisor — confirmed.
2. Supervisor tests pass with new assertions — confirmed (71/71).
3. `pnpm test` across repo passes modulo pre-existing unrelated failures — confirmed (cookies test env issue is pre-existing, verified).
4. Manual verification spec (for user after FIX-Reporter + FIX-InsightsUI land): `jq '.insightDetails[].insightSetId' .perf-agent/reports/latest.json` should now yield `"NAVIGATION_0"` (or similar) for every entry — pending end-to-end TUI run by lead.

## Files changed

- `packages/supervisor/src/reporter.ts` — extended `extractInsightSetId` (factored `matchInsightSetId` helper, now walks wrapped `action` shape).
- `packages/supervisor/tests/reporter.test.ts` — three new test cases covering wrapped shape, missing setId, multi-trace coverage.

## Out of scope (intentionally not touched)

- `packages/local-agent/src/tool-loop.ts` — auto-drill synthesis is untouched; reporter adapts to the existing MCP-wrapped convention.
- InsightsOverlay UI rendering — owned by FIX-InsightsUI (#23).
- Overlay sizing — owned by FIX-Center (#21).
