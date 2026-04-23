# Harness trace archive

Captured ndjson traces from `pnpm --filter @neuve/perf-agent-cli run harness:capture`.
One JSON object per line. Event schema:

```
{ "ts": number, "type": "agent_message", "content": string, "turn": number }
{ "ts": number, "type": "tool_call",     "name": string, "args": unknown, "turn": number, "id": string }
{ "ts": number, "type": "tool_result",   "id": string, "result": unknown, "ok": boolean }
{ "ts": number, "type": "status_marker", "marker": "STEP_START"|"STEP_DONE"|"ASSERTION_FAILED"|"STEP_SKIPPED"|"RUN_COMPLETED", "payload": unknown }
{ "ts": number, "type": "stream_terminated", "reason": string, "remainingSteps": number }
```

- `ts` is a millisecond Unix timestamp recorded when the event arrived from the agent stream.
- `turn` is a 1-indexed counter of agent turns within a single run.
- `id` on `tool_call` / `tool_result` is a local string id used to pair a call with its result inside the trace.
- The final event in every well-formed trace is `stream_terminated`. Its `reason` describes what closed the stream (`run_finished`, `grace_period_elapsed`, `error:<code>`, etc.) and `remainingSteps` is the number of status-marker steps that were started but never hit a terminal marker.

Replay is byte-equivalent: `pnpm tsx scripts/replay-harness-trace.ts evals/traces/<name>.ndjson` re-emits each line verbatim in the order it was written.
