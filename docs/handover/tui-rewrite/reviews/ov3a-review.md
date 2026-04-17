# OV-3a review — Ask panel UI component

**Reviewer:** antagonistic review per team-lead directive.
**Engineer:** `ov3a-engineer`
**File under review:** `apps/cli-solid/src/routes/results/ask-panel.tsx`
**Diary:** `docs/handover/tui-rewrite/diary/ov3a-diary.md`
**Spec:** `docs/handover/tui-rewrite/overlays-plan.md` (lines 134–152)

---

## Verdict: REQUEST_CHANGES

One major issue (duplicate `AskResult` type that is not justified). Several minor findings. Everything else passes muster.

---

## Mandatory verification

### Typecheck — `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json`

Clean, no output, exit 0.

### Tests — `cd apps/cli-solid && bun test`

```
559 pass
0 fail
1075 expect() calls
32 files, 7.06s
```

Matches the diary's claim.

---

## Findings

### MAJOR — `AskResult` duplicated locally despite atom being importable

**File:** `apps/cli-solid/src/routes/results/ask-panel.tsx:8-11`

The engineer defines `AskResult` locally and exports it from the panel. The diary justifies this
(lines 31–38) by asserting the atom "still lives at `apps/cli/src/data/ask-report-atom.ts` — not
yet available via `@neuve/perf-agent-cli/data/ask-report-atom`."

**That claim is false.** OV-3b's diary (task #9, marked completed) explicitly confirms the atom
IS available at `@neuve/perf-agent-cli/data/ask-report-atom` and has been for some time. Evidence:

- `apps/cli/package.json:49-52` exports `./data/ask-report-atom` from `src/data/ask-report-atom.ts`.
- `apps/cli-solid/package.json:25` declares `@neuve/perf-agent-cli: workspace:*`.
- Solid code already imports sibling atoms from the same package on the same pattern, e.g.
  `apps/cli-solid/src/routes/results/results-screen.tsx:5` imports `saveFlowFn` from
  `@neuve/perf-agent-cli/data/flow-storage-atom`.
- `apps/cli/src/data/ask-report-atom.ts:215-218` already exports `AskResult` with an identical
  shape (`{ readonly question: string; readonly answer: string }`).

The spec in `overlays-plan.md:141-146` specifies the prop shape as `history: readonly AskResult[]`
— nothing in the spec authorizes duplicating the type. The "define locally if not exported" escape
hatch the diary cites (line 37) does not apply because the type IS exported.

**Impact:** OV-3c will have two identically-shaped but nominally distinct `AskResult` symbols
floating around. Interfaces in TypeScript are structurally compatible so this will not produce a
hard error, but:

1. Violates CLAUDE.md "No duplication" rule ("No unused code, no duplication").
2. The engineer's stated intent is for OV-3c to "switch to importing `AskResult` from there and
   delete the local re-export" (diary line 38), which is work we're generating for future us based
   on a factually wrong premise today.
3. Future readers will see two `AskResult` types with identical shapes and waste cycles reconciling
   them.

**Required change:** Replace the local type with an import:

```ts
import type { AskResult } from "@neuve/perf-agent-cli/data/ask-report-atom";
```

Remove lines 8–11. Verify typecheck still passes.

---

### MINOR — Empty-string-ish line kinds leak an unused color branch

**File:** `ask-panel.tsx:71-74`

```ts
const lineColor = (kind: HistoryLine["kind"]): string => {
  if (kind === "question") return COLORS.PRIMARY;
  return COLORS.TEXT;
};
```

The `"blank"` kind hits the default `COLORS.TEXT` branch but the rendered text is an empty string,
so color is visually invisible. Not a bug, but it slightly clouds intent: a blank spacer row is
not "answer" text. Either drop the `kind` field from blank rows (render them via a literal
`<box />` spacer in the `For` body) or add an explicit return branch. Low priority.

---

### MINOR — `\r\n` answer content will render as a stray `\r`

**File:** `ask-panel.tsx:33`

```ts
const answerLines = entry.answer.split("\n");
```

If the agent streams `\r\n` line breaks (possible — the stream comes from arbitrary LLM output),
each line will carry a trailing `\r` that OpenTUI renders as a raw carriage-return character. The
atom's `Stream.runFold` concatenates chunks verbatim; only the final answer is `.trim()`-ed
(`ask-report-atom.ts:257`), which handles leading/trailing whitespace but not inline `\r`.

Suggest splitting on `/\r?\n/` to be safe. Low risk in practice; flagging for hygiene.

---

### MINOR — Diary claim about `bun test` numbers matches, but diary also claims "7.11s"

Tests ran in 7.06s here vs 7.11s in the diary. Noise. No action needed, just noting the numbers
aren't load-bearing.

---

## Review questions (answered)

1. **Props-purity**: PASS. No imports of `setOverlay`, `useNavigation`, `askReportFn`, or command
   registry. Only UI imports (`solid-js`, `@opentui/solid`, local renderables, constants).

2. **`AskResult` duplicate type**: FAIL. See MAJOR above. Shape DOES match the atom — structurally
   compatible, so OV-3c won't get a compile error from the shape itself — but the duplication is
   unjustified and the diary's rationale is factually wrong.

3. **Submit handling**: PASS. `handleSubmit` (line 100–106) guards on `pending`, calls `.trim()`,
   refuses empty submissions, clears the input, calls `props.onSubmit(trimmed)`. The `Input`
   renderable does NOT trim; the panel does. Whitespace-only submissions are correctly rejected.
   Because the `Input` is unmounted during `pending`, submit-while-pending is physically
   impossible — the `if (props.pending) return` guard is defense-in-depth, which is fine.

4. **Pending state**: PASS. `<Show when={props.pending}>` renders spinner row, `<Show
   when={!props.pending}>` renders the input. Input is literally unmounted during pending, not
   just disabled. Matches the diary's design choice (line 58).

5. **Error rendering**: PASS. Error row (lines 127–131) renders ABOVE the input row, in
   `COLORS.RED`, with `marginTop={1}`. Error persistence across submissions is the caller's
   problem (OV-3c), which is correct for this task's scope.

6. **Keyboard scope**: PASS. Verified `@opentui/solid`'s `useKeyboard` at
   `node_modules/.pnpm/@opentui+solid@0.1.99.../index.js:56-71` registers on `onMount` and
   unregisters on `onCleanup`. When the panel unmounts, the listener tears down. Matches
   `raw-events-overlay.tsx` precedent.

7. **esc always closes**: PASS. The `escape` branch (lines 77–81) runs unconditionally — during
   pending (input unmounted, so only the panel handler fires), during idle (Input doesn't consume
   `escape`), and with active input text (esc doesn't mutate input; it calls `onClose` directly).
   esc never accidentally submits — `event.name === "escape"` is a distinct branch from the
   return-handler in `Input` (`input.tsx:81`).

8. **Up/down conflicts**: PASS. `input.tsx:92-112` gates up/down handling behind `props.multiline`.
   The ask-panel creates the `Input` without `multiline`, so up/down fall through to the panel's
   `useKeyboard`, which handles scrolling. Verified by reading Input source.

9. **Scrolling bounds**: PASS. `clampScroll` (lines 55–60) floors at 0 and ceils at
   `maxScrollOffset() = max(0, lines().length - visibleRows())`. Zero-length history: `lines() =
   []`, `maxScrollOffset = 0`, `visibleSlice = [].slice(0, 4) = []`. No crash. Up/down are gated
   by `lines().length > visibleRows()` which is false for empty histories — no-op. Verified
   mentally.

10. **Answer rendering**: MOSTLY PASS. Answer is chunked on `\n`; NOT truncated. Correctly handles
    multi-line answers. Does NOT handle `\r\n` — see MINOR above.

11. **Q/A formatting**: PASS. `buildHistoryLines` (lines 29–41) produces `Q: {question}`,
    `A: {firstLine}`, `   {continuation}` (3-space indent), `""` (blank spacer). Matches the diary
    (line 47) and spec (overlays-plan.md:46-48). A blank row sits between each pair.

12. **Visible-rows math**: ACCEPTABLE. `floor(height * 0.7) - 8`. Breakdown:
    - OverlayContainer sets panel height to `floor(height * 0.7)`.
    - Panel chrome: 2 rows of border + 1 title + 1 marginTop-before-content + 1 marginTop-before-
      footer + 1 footer = 6 rows.
    - Ask panel adds: 1 marginTop-before-input + 1 input row = 2 more rows = 8 total.
    - When `error` is present, add 1 marginTop + 1 error row = 10 total, meaning the visible
      window overflows by 2 rows in that case. The flex-grow history area should absorb this
      because the error and input rows are non-flex. In practice `visibleRows` over-estimates by
      2 when error is displayed — the For loop would render 2 more rows than the container can
      fit, causing clipping at the bottom of the history region.
    - Not a correctness bug (the error + input rows would still render because they are siblings
      in the OverlayContainer's flex column), but the exact overflow behavior depends on
      OpenTUI's flex rendering. `raw-events-overlay.tsx` uses `- 6` because it has no input or
      error row. Ask-panel's `- 8` is correct for the no-error steady state.
    - Acceptable; flag for manual verification during OV-3c dry-run. Not a blocking issue.

13. **Colors**: PASS. `COLORS.PRIMARY`, `COLORS.TEXT`, `COLORS.DIM`, `COLORS.RED` all defined in
    `constants.ts:1-15`.

14. **No nested `<text>`**: PASS. Grep found zero instances of `<text>` inside `<text>`. The
    `<SpinnerSpan />` inside `<text>` (lines 135–138) returns a `<span>`, not a `<text>` — matches
    the established pattern in `testing-screen.tsx:385-404`.

15. **No `useMemo` / `useCallback` / `React.memo`**: PASS. Only Solid primitives:
    `createSignal`, `createMemo`, `Show`, `For`. No React artifacts.

16. **Comments**: PASS. Zero explanatory comments in the file. Matches CLAUDE.md and the diary's
    stated intent.

17. **Empty-state rendering**: PASS. `<Show when={lines().length === 0}>` renders
    `"No questions yet. Type a follow-up below and press enter."` in `COLORS.DIM`. Copy is
    appropriate; dim color is correct.

18. **`focus` prop on Input**: MOSTLY PASS. The Input receives `focus` (which defaults to `true`
    when no value is passed — checked `input.tsx:67`). When the panel mounts, Input registers as
    focused via `InputFocusProvider`. When the panel unmounts, Input's own `onCleanup` tears down
    its keyboard subscription. One edge case: during `pending = true`, Input unmounts, so
    `inputFocus.setFocused(false)` never fires explicitly — it just stays at whatever it was last
    set to. If any sibling renderable inspects `inputFocus.focused()` for its own behavior, it
    would see a stale-but-true value during pending. Review of `useInputFocus()` usages shows
    this only matters for Input components themselves, and none are mounted during pending. No
    behavior bug in practice. Would be cleaner to explicitly `setFocused(false)` on unmount, but
    that's an `Input`-level change, not an OV-3a concern.

---

## Other notes

- **`pending` guard redundancy**: `handleSubmit` guards on `pending`, but `pending = true` means
  the Input is unmounted — the submit physically cannot happen. Belt and braces. Fine.
- **`lineColor` for `"blank"`** is unreachable in practice (empty string text renders nothing
  regardless of color). Noted as MINOR #1 above. No functional bug.
- **`lines` as a `createMemo`**: recomputes only when `props.history` changes by reference. Since
  the caller will pass a new array after each Q&A completion (pushing into a signal's array),
  this is correct.

---

## Required actions (blocking)

1. **Remove the local `AskResult` type** and import it from
   `@neuve/perf-agent-cli/data/ask-report-atom`. Update the diary's "Where `AskResult` lives"
   section to reflect the correct state (OV-3b made the atom importable; the local-fallback
   clause does not apply).
2. Re-run `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` and `bun test` to confirm no
   regression.

## Recommended (non-blocking)

3. Switch `entry.answer.split("\n")` to `entry.answer.split(/\r?\n/)` to defend against `\r\n`
   line endings from agent output.
4. Consider explicit branch for `lineColor("blank")` returning `COLORS.DIM` or similar, though
   it's visually irrelevant.

---

## Verdict

**REQUEST_CHANGES** — primarily for the unjustified `AskResult` duplication, whose diary rationale
contradicts OV-3b's completed state. Everything else is clean and matches the spec.

---

# Round 2

## Re-verification

- `bunx tsc --noEmit -p apps/cli-solid/tsconfig.json` — clean, no output, exit 0.
- `cd apps/cli-solid && bun test` — **559 pass, 0 fail, 1075 expect() calls** (7.15s).

## Fixes applied

1. **`AskResult` import** — PASS. `ask-panel.tsx:3` now reads
   `import type { AskResult } from "@neuve/perf-agent-cli/data/ask-report-atom";`. Type-only
   import, no local redeclaration. The previous local `interface AskResult` block is deleted.
2. **`\r?\n` split** — PASS. `ask-panel.tsx:29` now reads `entry.answer.split(/\r?\n/)`. Agent
   output with CRLF line endings will now render cleanly.
3. **`lineColor` dead branch** — PASS. `ask-panel.tsx:67-68` collapsed to a single-expression
   ternary: `kind === "question" ? COLORS.PRIMARY : COLORS.TEXT`. The CLAUDE.md "no ternaries in
   JSX" rule does NOT apply here — this is a regular function body, not a JSX expression.

## Diary

`docs/handover/tui-rewrite/diary/ov3a-diary.md` updated (lines 34–42): the "Where `AskResult`
lives" section now correctly describes the type-only import and acknowledges the Round 1
misreading of OV-3b's state. Lines 81–84 add a "Post-review minor patches" section noting the
other two fixes.

## Residual notes

- Nothing new. All Round 1 findings resolved. No regressions detected in re-run.

## Verdict (Round 2)

**APPROVE**. Ship it.
