# Dry-run Telemetry Criteria

A binary signal checklist for evaluating each post-fix dry-run of `perf-agent tui -a local -u https://agent.perflab.io` with the perflab perf-analysis prompt. Replaces the ad-hoc "did it work?" look at screenshots.

## How to read each row

After a dry-run, tail `.perf-agent/local-agent.log` and check the screenshot. Match observations to the table below. **Each row decides the next action.** If multiple rows fire, the bottom-most match wins (more severe).

## The table

| # | Signal in `local-agent.log` and TUI | Meaning | Next action |
|---|--------------------------------------|---------|-------------|
| 1 | `auto-wrapped tool args` fires ≥ 1 time AND `Validation error:` count drops to 0 AND TUI shows CWV table with real numbers | **P0 + P1 stack worked.** Wrapper auto-fix is doing its job; Gemma's calls now reach DevTools. | Bank the win. Stop. Re-evaluate P2 only if next regression appears. |
| 2 | `auto-wrapped tool args` fires ≥ 1 time AND `Validation error:` count drops to 0 AND TUI shows fallback "didn't capture trace" | **Validation passing but Gemma not calling trace.** Tool calls succeed but model picks `interact`/`observe` and never `trace`. | Investigate LOCAL_AGENT_SYSTEM_PROMPT — likely missing perf-analysis workflow guidance. Separate from P0/P2. |
| 3 | `auto-wrapped tool args` does NOT fire AND `Validation error:` still appears AND error text mentions `action` or wrapper | **P0 heuristic mis-detected the wrapper.** Detection logic in `mcp-bridge.ts` failed to identify the macro tools at startup. | Debug `detectWrapperKey` — likely the OpenAI tools spec from MCP doesn't carry `oneOf`/`anyOf` shape we expected. Inspect `tools[].function.parameters` in the OpenAI listTools output. |
| 4 | First `tool error` shows error text NOT about `action`/wrapper but about a different field (typo'd command, missing arg, wrong type) | **Wrapper was not the only failure.** Second failure mode emerged. Field consensus says the answer is structural (P2). | Pull P2 Phase A forward immediately. Flat trace tools eliminate this entire failure class. |
| 5 | `doom loop detected` fires | **Gemma can't self-correct even with hint text.** Synthesis §6 #4 confirmed: Gemma 4 ignores structured error feedback regardless of shape. | Pull P2 Phase A forward immediately. Hint-loop strategy doesn't work for Gemma; only prevention works. |
| 6 | TUI shows `c/n/i` hints (console/network/insight panels populated) but NOT CWV table | **Observe tools work; trace tools still fail.** Could be wrapper detection inconsistency, could be Gemma avoiding trace. | Investigate `auto-wrapped` log for trace specifically vs observe. If wrapper fires for observe but not trace, schema shape differs — check `trace.ts` inputSchema vs `observe.ts`. |

## Required raw signals

When reading the log after a run, capture:

1. **Count of each log keyword**: grep for `tool call`, `auto-wrapped tool args`, `tool error`, `detected tool wrapper key`, `doom loop detected`. Tabulate.
2. **First error verbatim**: copy the `errorText` from the first `tool error` line — that's the canonical Zod failure message.
3. **First raw args verbatim**: copy the `args` JSON from the first `tool call` line — that's what Gemma actually emitted.
4. **Final `contentPreview` from last `ollama responded`**: the model's parting message tells us its self-narrative of what failed.
5. **Round count**: how many `calling ollama` lines fired before stop. ≤ 4 is doom-loop short-circuit; ≥ 8 is the model giving up on its own; 15 is `MAX_TOOL_ROUNDS` exhaustion.

## What success looks like (positive signal)

- `mcp bridge connected` followed shortly by 3 lines of `detected tool wrapper key` (one per macro tool).
- First `tool call` log shows raw `{"command": "navigate", "url": "..."}` form.
- Immediately followed by `auto-wrapped tool args { tool: "interact", wrapperKey: "action" }`.
- No `tool error` lines.
- Multiple `calling ollama` rounds, each completing with successful tool dispatches.
- TUI shows CWV table with non-zero LCP/CLS values.
- TUI shows `c` / `n` / `i` modeline hints because captures populated.

## What partial-success looks like

- `auto-wrapped tool args` fires for `interact`/`observe` but never for `trace`.
- TUI shows c/n/i hints but no CWV table.
- → indicates wrapper detection works but Gemma doesn't choose trace.

## What hard-failure looks like

- `auto-wrapped tool args` never fires (detection broken).
- OR `auto-wrapped tool args` fires correctly but `tool error` *still* appears (other failure modes present).
- OR `doom loop detected` fires (Gemma can't self-correct at all).
- → pulls P2 Phase A forward.

## Phasing P2

Phase A trigger conditions:
- Row 4 OR Row 5 OR Row 6 above fires.

Phase B trigger conditions (after Phase A lands):
- Phase A dry-run shows Gemma reliably calls flat trace tools (CWV table renders) → Phase B justified.
- Phase A dry-run shows Gemma still doesn't reach trace → P2 wasn't the blocker; investigate LOCAL_AGENT_SYSTEM_PROMPT instead.
