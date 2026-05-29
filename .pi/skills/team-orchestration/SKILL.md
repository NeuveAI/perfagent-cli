---
name: team-orchestration
description: Use when coordinating complex multi-phase work. Spawns engineer/reviewer teammates via subagents, manages phase dependencies, and enforces review gates.
---

# Team Orchestration

Coordinate complex work using specialized subagent teammates. Each phase has a dedicated engineer and reviewer.

## Core Principles

**Phases are sequential.** Phase N+1 waits for Phase N's reviewer APPROVE. Parallelize within phases only.

**Team boundaries:**
- **Implementer:** Worker agent focused on execution
- **Reviewer:** Antagonistic critique posture, merge-blocking authority
- **Diary keeper:** Chronological log of decisions and outcomes

**Evidence gates:**
- Read prior work before each phase
- Verify invariants (build, tests, logs)
- No ship without reviewer APPROVE

## Phase Workflow

### T0 — Kickoff
1. Read handover + all prior work
2. Create phase diary entry
3. Spawn implementer subagent
4. Spawn reviewer subagent (different agent for final audit)

### T1 — Implement
1. Implementer executes plan
2. Creates/updates files per spec
3. Runs `pnpm check` (typecheck + lint + format)
4. Runs `pnpm test` before PR
5. Submits for review

### T2 — Review
1. Reviewer reads work + prior context
2. Applies strict-critique workflow
3. Verifies invariants
4. Verdict: APPROVE / REQUEST_CHANGES / INVESTIGATIVE-VERIFIED

**Blocker rule:** REQUEST_CHANGES blocks dismissal until resolved

### T3 — Ship
1. Granular commits (no squash after APPROVE)
2. Update handover diary
3. Teardown teammates

## Agent Workflow

For multi-phase work, use specialized agents with explicit handoffs:

**Step 1 — Planner analyzes and creates plan**
```
Read handover and create implementation plan for Phase N
```

**Step 2 — Worker executes the plan**
```
Implement per plan: {planner_output}
```

**Step 3 — Reviewer audits the work**
```
Audit implementation: {worker_output}
```

Each phase waits for reviewer APPROVE before proceeding to the next.

## Team Spawn Pattern

When using team orchestration, spawn teammates sequentially with handoff context:

```typescript
// T0 — Read handover, spawn planner
const plan = readHandover().then(analysis => {
  return spawnAgent("planner", `Analyze and create plan: ${analysis}`);
});

// T1 — Implementer executes
const implementation = plan.then(result => {
  return spawnAgent("worker", `Implement per plan: ${result.output}`);
});

// T2 — Reviewer audits
const review = implementation.then(result => {
  return spawnAgent("reviewer", `Audit implementation: ${result.output}`);
});
```

## Diary Keeper

After each phase, update the handover diary:

```markdown
# Phase Diary — {phase-name}

## What we did
- Concrete actions, not vibes

## Verdict
- APPROVE / REQUEST_CHANGES / INVESTIGATIVE-VERIFIED
- Severity breakdown: BLOCKING / MAJOR / MINOR counts

## Evidence
- File paths, line numbers, log citations

## Next phase
- Dependencies and handoff
```

## Process Invariants

**Read before act:** Always read prior work before planning (handover, diary, reviews)

**Build before evals:** `pnpm --filter @neuve/local-agent build` when touching local-agent source

**Real services only:** No `MockLanguageModelV4` — use live backend

**Distribution gates:** Baseline evals over distribution-form, not single samples

**No prompt overfitting:** Reasoning-framework changes only, not prompt tuning

**Granular commits:** After APPROVE, commit per-phase work (no Co-Authored-By)

**Destructive git opt-in:** No `stash` / `reset --hard` / `checkout --` without explicit request

## Verification Checklist

Before ship:
- [ ] All prior work read (handover + diary + reviews)
- [ ] Build passed for modified packages
- [ ] Tests pass (`pnpm test`)
- [ ] Typecheck + lint clean (`pnpm check`)
- [ ] Reviewer APPROVE on file
- [ ] Handover diary updated
- [ ] Teardown teammates (stop running subagents)

---

Usage: `/skill:team-orchestration` or when coordinating multi-phase harness work
