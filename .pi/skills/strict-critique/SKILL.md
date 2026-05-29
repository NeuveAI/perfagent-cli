---
name: strict-critique
description: Antagonistic code review posture. Use for merge-blocking audits, end-of-wave reviews, and verifying process invariants. Enforces evidence-first gatekeeping.
---

# Strict Critique

Adversarial review for merge-blocking gates. Assume the work is wrong until proven right with evidence.

## Core Rules

**Evidence-first:**
- Read files before judging
- Demand log/trace citations, not assertions
- Verify invariants mechanically (build, tests, distribution gates)

**Merge-blocking severity:**
- **BLOCKING:** Must fix before merge (breaking, process violation)
- **MAJOR:** Fix before ship (quality, coverage gaps)
- **MINOR:** Post-merge nice-to-haves (nits, polish)

**Blocker rule:** Any BLOCKING/MAJOR = REQUEST_CHANGES. Iterate until APPROVE.

## Review Workflow

### T0 — Setup
1. Read the full task + prior work (handover, diary, reviews)
2. Load the implementation for audit
3. Identify what SHOULD have been done per spec

### T1 — Evidence Gathering
1. **Read files in sequence:**
   - Handover/diary entries for context
   - Implementation files being reviewed
   - Test files and evals
   - Log files (.expect/logs.md) for runtime evidence

2. **Check process invariants:**
   - [ ] Build before evals (`pnpm --filter @neuve/local-agent build`)
   - [ ] Real services (no MockLanguageModelV4)
   - [ ] Distribution-form gates (baseline evals, not single-sample)
   - [ ] No prompt overfitting (reasoning-framework changes only)
   - [ ] Typecheck + lint clean (`pnpm check`)
   - [ ] Tests pass (`pnpm test`)

3. **Verify implementation:**
   - Code matches the spec
   - No rationalizations (agent didn't skip steps)
   - No test-only seams bleeding into prod
   - Proper error handling (Effect patterns, no swallows)

### T2 — Verdict

**APPROVE:** All BLOCKING/MAJOR resolved, ready to merge

**REQUEST_CHANGES:** Unresolved blockers, must fix:
- Number each issue with severity
- Provide file paths + line numbers
- Suggest concrete fixes

**INVESTIGATIVE-VERIFIED:** Work verified through evidence (logs, traces), not manual inspection

## Common Violations

| Violation | Severity | Fix |
|-----------|----------|-----|
| Skipped build before evals | BLOCKING | `pnpm --filter @neuve/local-agent build` |
| Mock LM in prod | BLOCKING | Real backend service |
| Single-sample gate | BLOCKING | Distribution-form baseline evals |
| No tests before ship | MAJOR | `pnpm test` pass |
| Type errors | MAJOR | `pnpm check` clean |
| Over-implementation | MINOR | Align to spec, not beyond |
| Missing handover update | MINOR | Diary + baseline entries |

## Output Format

```
## Review Verdict

**Verdict:** {APPROVE / REQUEST_CHANGES / INVESTIGATIVE-VERIFIED}

**Summary:** {2-sentence overview}

## Findings

### {BLOCKING/MAJOR/MINOR} — {Finding title}

**Evidence:** File path + line numbers + log citations

**Impact:** Why this matters

**Fix:** Concrete remediation steps

## Process Invariants

- [ ] Build before evals: {pass / FAIL — {reason}}
- [ ] Real services: {pass / FAIL — {reason}}
- [ ] Distribution gates: {pass / FAIL — {reason}}
- [ ] Typecheck + lint: {pass / FAIL — {reason}}
- [ ] Tests pass: {pass / FAIL — {reason}}

## Next Steps

{If REQUEST_CHANGES: What must change before merge}
{If APPROVE: Ready to ship, granular commits after}
```

## Handoff Pattern

When reviewing another agent's work:

1. Read the implementation files
2. Read the prior handover/diary for context
3. Run process invariant checks
4. Produce verdict with evidence
5. Pass verdict back to coordinating agent

## Rationalization Patrol

Watch for these agent excuses:

| Agent Says | Verdict |
|------------|---------|
| "This is simple enough to skip tests" | BLOCKING — every change gets tested |
| "I already verified manually" | MAJOR — run the actual test suite |
| "The user didn't ask for X" | MINOR — process requires it regardless |
| "I'll fix it in a follow-up" | BLOCKING — ship complete work |
| "It works on my machine" | MAJOR — distribution gates, not single-sample |

---

Usage: `/skill:strict-critique` or when the user says "review this", "audit", "strict critique"
