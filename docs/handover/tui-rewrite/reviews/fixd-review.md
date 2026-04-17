# FIX-D Review — RuledBox layout collision

**Reviewer:** fixd-reviewer
**Target:** `apps/cli-solid/src/renderables/ruled-box.tsx` + 5 header callsites
**Diary:** `docs/handover/tui-rewrite/diary/fixd-diary.md`
**Round 1 verdict:** REQUEST_CHANGES
**Round 2 verdict:** APPROVE

---

## Summary

The engineer's root-cause analysis is correct and well-supported: opentui's
`flexShrink=1` default (Renderable.ts:725) combined with Text's measureFunc
capping at `Math.min(effectiveHeight, measuredHeight)`
(TextBufferRenderable.ts:404-408) is exactly how sibling `<text>` nodes in a
compressed flex-column collapse to height=0 and stack on the same row. The
`flexShrink={0}` intervention on the RuledBox internals is the correct class of
fix for the "Copy this summary now" callout.

**However, the patch does not cover the other screenshot-visible collision.**
The garbled header (Image #6: "PerffAgent vdevormance...") is a SEPARATE
instance of the same bug in the exact same file the fix touched as a caller
(`results-screen.tsx:115-121`), and FIX-D does not remediate it. By the
engineer's own root cause, that header will continue to scramble under the same
conditions. This is a MAJOR issue — FIX-D claims to resolve the scrambled-text
bug but only addresses one of two visible collisions.

Additionally, the same header pattern exists unguarded in **four other route
files** (testing, cookie-sync-confirm, port-picker, and indirectly
session-picker). Leaving them unshrunk is a latent regression surface.

---

## Verification results

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | exit 0, clean |
| `bun test` (cli-solid) | 564 pass / 0 fail |
| `git diff` — only `ruled-box.tsx` modified | Yes |
| Diary claim: opentui flexShrink=1 default at Renderable.ts:725 | Confirmed |
| Diary claim: Text measureFunc collapses to height=0 | Confirmed (TextBufferRenderable.ts:394,404-407) |
| Diary claim: context-picker wraps `<text>` in `<box>` and is immune | Confirmed (context-picker.tsx:90, 103) |

---

## Findings by team-lead question

### 1. Fix minimality — PASS
Diff shows edits restricted to `apps/cli-solid/src/renderables/ruled-box.tsx`
(4 attribute additions on the outer box, inner box, and two rule `<text>`s).
No spillover to other components.

### 2. Outer vs inner — both are justified, though arguably only the outer is strictly load-bearing
Team-lead's hypothetical: if the outer doesn't shrink but the inner does, does
the rule `<text>` still render OK?

- Yoga shrink is a *parent-driven* operation: when the screen column runs
  short, it distributes shrinkage across its *direct* flex children — here,
  the RuledBox outer. If the outer refuses to shrink (`flexShrink={0}`), the
  screen column can't take vertical budget from RuledBox's subtree at all,
  and the inner padded box + rule `<text>`s are never asked to shrink.
- In that theoretical world, the inner `flexShrink={0}` is redundant
  defense-in-depth. But it's cheap, it matches the opencode convention
  (diary section 4), and it hardens against future refactors where someone
  might remove the outer shrink guard. Acceptable as belt-and-suspenders.

**Not a blocker**, but the engineer could have documented that the outer is
the minimum viable guard.

### 3. Rule text shrink — PASS
`"─".repeat(columns())` is visually dash-filler; shrinking it would be benign
character-wise. However, if the rule `<text>` shrank to height=0 it would
still collide with adjacent rows (same bug class), so the `flexShrink={0}` on
rule text is defensible — it's not overkill, it prevents the same collapse
from applying to the rules themselves.

### 4. Side-effects on vertical overflow — ACCEPTABLE with caveat
The parent chain in `results-screen.tsx:113` is:
```
<box flexDirection="column" width="100%" paddingTop={1} ... paddingRight={1}>
```
No `overflow="scroll"`. Before FIX-D, overflow manifested as *scrambled* text
(measureFunc collapse). After FIX-D, a too-short terminal will simply push
later content off-screen — worse UX for tall lists on short terminals, but
strictly better than garble. The diary addresses this explicitly
(lines 229-232) with guidance to resize the terminal. **Acceptable tradeoff
for the current scope**, but the TUI will eventually want a proper scroll
container for Results. Not a blocker for FIX-D.

### 5. Sibling parity — **MAJOR ISSUE**
The same pattern — a default-column `<box>` containing multiple stack children
with no `flexShrink={0}` guard — exists in the following places:

| File | Lines | Pattern |
| --- | --- | --- |
| `apps/cli-solid/src/routes/results/results-screen.tsx` | 115-121 | `<box>` → `<Logo />` + `<text>` (HEADER) |
| `apps/cli-solid/src/routes/testing/testing-screen.tsx` | 222-228 | `<box>` → `<Logo />` + `<text>` (HEADER) |
| `apps/cli-solid/src/routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx` | 158-166 (approx) | `<box>` → `<Logo />` + `<text>` (HEADER) |
| `apps/cli-solid/src/routes/port-picker/port-picker-screen.tsx` | 267-273 (approx) | `<box>` → `<Logo />` + `<text>` (HEADER) |
| `apps/cli-solid/src/routes/session-picker/session-picker-screen.tsx` | 133-137 | `<box marginBottom={1}>` → `<Logo />` + `<text>` |

All of these are vulnerable. See question 8 below for the specific Results
header case.

### 6. Test regression — PASS
`tests/renderables/ruled-box.test.tsx` does content-string assertions
(`frame.toContain("Inside the box")`) and does NOT do layout snapshots. The
new `flexShrink={0}` does not regress any assertion. 564/564 tests pass.

### 7. Context-picker immunity — PASS
`apps/cli-solid/src/routes/main/context-picker.tsx:89-120` wraps each child
inside RuledBox in its own `<box>`:
- line 90: `<box marginBottom={0}>` around the query `<text>`
- line 103 (in `For`): `<box>` around each option `<text>`

These wrapper boxes are sized to content (each holds one `<text>`), so Yoga's
shrink pass cannot drive two sibling `<text>` into the same row because the
sibling boxes own the row spacing. Engineer's claim is verified.

Worth noting: the *title/empty-state* `<text>` on line 117-118
(`<text style={{ fg: COLORS.DIM }}>No matching contexts</text>`) is a direct
`<text>` sibling of the `<For>`-returned boxes, so in theory it could collide
with those boxes under compression. But because it only renders when
`filteredOptions().length === 0` (and thus there are NO `<For>`-boxes to
collide with) this is safe in practice.

### 8. **CRITICAL** — Results header is a DIFFERENT collision that FIX-D does not fix

`apps/cli-solid/src/routes/results/results-screen.tsx:115-121`:
```tsx
<box>
  <Logo />
  <text>
    <span style={{ fg: COLORS.DIM }}>{` ${POINTER} `}</span>
    <span style={{ fg: COLORS.TEXT }}>{props.report.instruction}</span>
  </text>
</box>
```

`Logo` is `<box><text/></box>` (renderables/logo.tsx:8-17). So the header
`<box>` contains two flex children (default direction column):
1. the Logo's wrapper `<box>` — `flexShrink=1` (no numeric width/height)
2. the instruction `<text>` — `flexShrink=1` (no numeric width/height)

Both inherit the web default `flexShrink=1`. When the Results screen's main
column runs short (same conditions that cause the callout garble), Yoga will
shrink both, and by the exact same mechanism (TextBufferRenderable measureFunc
capping at `effectiveHeight`), the Logo's text and the instruction text can
collapse to the same row. This is consistent with Image #6's reported garble:
"PerffAgent vdevormance..." is the Logo ("✘✔ Perf Agent vdev") overwriting
the instruction text ("▸ analyze performance of...") character-by-character.

**FIX-D does not address this.** It only hardens RuledBox internals. The
header box and its children remain `flexShrink=1`.

By the engineer's own root-cause claim, this means the *header garble in Image
#6 will still occur after FIX-D*. The bug report is not fully resolved.

Additionally, the identical header pattern appears in `testing-screen.tsx:222`,
`cookie-sync-confirm-screen.tsx:158`, `port-picker-screen.tsx:267`, and
arguably `session-picker-screen.tsx:133`. All vulnerable.

---

## Required changes to approve

1. **Fix the header collision** in `results-screen.tsx:115-121`. Either:
   - Add `flexShrink={0}` to the outer header `<box>` (consistent with opencode
     convention cited in diary §4), OR
   - Add `flexShrink={0}` to the `Logo` wrapper box (`renderables/logo.tsx:9`)
     AND to the sibling `<text>` elements in each header callsite.

   Preferred: add `flexShrink={0}` to the outer header `<box>` in each header
   callsite. This is parallel to how RuledBox was fixed (outer guard is the
   minimum viable shield).

2. **Apply the same guard** to the other four affected routes:
   - `routes/testing/testing-screen.tsx:222`
   - `routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx:158`
   - `routes/port-picker/port-picker-screen.tsx:267`
   - `routes/session-picker/session-picker-screen.tsx:133`

3. **Add a regression test** (strongly recommended, not blocking): a test that
   renders RuledBox *inside* a height-constrained column with multiple other
   siblings and asserts that each line of the callout is on a distinct row
   (e.g. check that "Copy this summary now" and "Press y" never appear on the
   same frame line). Without this, the fix can silently regress if opentui
   changes shrink defaults.

4. **Optional (not blocking)**: consider extracting the header
   `<box><Logo />...</box>` pattern into a shared `ScreenHeader` renderable
   that bakes in `flexShrink={0}`, so new screens don't re-introduce the bug.

---

## Accepted claims

- Root cause in diary §1-3 is correct and well-evidenced.
- The `flexShrink={0}` intervention is the right shape of fix.
- Context-picker immunity claim is verified.
- No collateral damage to tests or types.
- Only `ruled-box.tsx` was touched; diff is minimal.

---

## Round 1 Verdict

**REQUEST_CHANGES.**

FIX-D correctly resolves the RuledBox-internal collision but fails to resolve
the header collision visible in the same screenshot (Image #6). By the
engineer's own theory of the bug, the header will still scramble under
compression. The user-visible bug is therefore not fully fixed, and four other
screens have the same latent collision.

The fix is on the right track — it just needs to be extended to the sibling
pattern the team-lead explicitly flagged as critical.

---

## Round 2 — engineer response

Engineer added `flexShrink={0}` to the outer header `<box>` in all five
flagged routes:

| File | Line | Change |
| --- | --- | --- |
| `routes/results/results-screen.tsx` | 115 | `<box>` → `<box flexShrink={0}>` |
| `routes/testing/testing-screen.tsx` | 222 | `<box>` → `<box flexShrink={0}>` |
| `routes/cookie-sync-confirm/cookie-sync-confirm-screen.tsx` | 158 | `<box>` → `<box flexShrink={0}>` |
| `routes/port-picker/port-picker-screen.tsx` | 267 | `<box>` → `<box flexShrink={0}>` |
| `routes/session-picker/session-picker-screen.tsx` | 133 | `<box marginBottom={1}>` → `<box marginBottom={1} flexShrink={0}>` |

Engineer declined the shared `ScreenHeader` extraction; documented three
divergences (POINTER vs POINTER_SMALL vs none, marginBottom presence,
static vs prop-driven instruction). Reasonable call — premature abstraction
over five call-sites that genuinely differ.

Regression test was not written — engineer could not reproduce the collapse
without tuning terminal geometry. Accepted per round 1 non-blocking note.

### Round 2 verification

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` | exit 0, clean |
| `cd apps/cli-solid && bun test` | 564 pass / 0 fail |
| `cd apps/cli-solid && bun run build` | exit 0, clean |
| `git diff --stat` | 6 files, +14 -9 lines |

### Round 2 findings

1. **All 5 flagged header boxes fixed at the correct nesting level.** For
   each file the `flexShrink={0}` is on the *outer* `<box>` that wraps
   `<Logo />` + sibling `<text>`, exactly where the shrink guard belongs
   (the parent decides shrink budget; the direct child owns the row
   containment). Verified by reading the context around each grep hit.

2. **Two `<Logo />` callsites remain unguarded** — `main-screen.tsx:154` and
   `startup-screen.tsx:61`. Both wrap ONLY `<Logo />` (no sibling text inside
   the same box), so the collision bug class does not apply: a single child
   cannot collide with itself.

   These are NOT regressions of FIX-D and do not need the guard for the
   reported bug. A separate latent issue exists — under extreme vertical
   compression the Logo's wrapper could still shrink to height=0 and make
   the logo disappear — but that produces a missing element rather than
   scrambled text, and it is out of scope for FIX-D.

3. **Diff minimality confirmed.** All non-ruled-box changes are single-line
   attribute additions. No spillover edits, no formatting drift, no collateral
   refactors.

4. **Context-picker and other RuledBox consumers** unaffected — RuledBox
   internals already hardened in round 1, and RuledBox itself is the shrink
   boundary for any component that renders inside it.

### Round 2 Verdict

**APPROVE.**

FIX-D now addresses both the RuledBox-internal collision and the header
collision visible in Image #6. All sibling-stack patterns with multi-text
children at screen headers are guarded. The remaining unguarded `<Logo />`
single-child wrappers do not exhibit the same bug class. tsc clean, 564/564
tests pass, build clean, diff minimal (6 files, 5 of them single-line
additions).

Ready to commit.
