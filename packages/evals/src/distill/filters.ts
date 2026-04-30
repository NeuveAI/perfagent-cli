import type { StatusMarkerEvent, TraceEvent } from "../runners/trace-recorder";
import { REDACTED_KEY_PATTERN } from "../redaction";
import type { SidecarScore } from "./sidecar-score";

export { REDACTED_KEY_PATTERN };

const asStatusMarker = (event: TraceEvent): StatusMarkerEvent | undefined =>
  event.type === "status_marker" ? event : undefined;

const hasAssertionAbort = (events: ReadonlyArray<TraceEvent>): boolean =>
  events.some((event) => {
    const marker = asStatusMarker(event);
    if (marker === undefined || marker.marker !== "ASSERTION_FAILED") return false;
    // ASSERTION_FAILED payload shape (runners/real.ts:65):
    // [stepId, message, category, abortReason]
    const payload = marker.payload;
    if (!Array.isArray(payload)) return false;
    return payload[2] === "abort";
  });

/**
 * isTraceSuccessful — accept traces that ended with `RUN_COMPLETED` carrying
 * `status === "passed"` AND contained no `ASSERTION_FAILED category=abort`
 * marker anywhere in the stream.
 *
 * Rationale: Wave 1.B defines two legitimate terminal states — full success
 * (all steps terminal) OR `ASSERTION_FAILED abort` followed by termination.
 * The second case is an aborted run, not a pass. Even if a future harness
 * quirk emits `ASSERTION_FAILED abort` and later writes `RUN_COMPLETED passed`
 * (recovery replay, fiber race), that's NOT a successful trajectory — the
 * abort contaminates the trace. Fine-tuning on it teaches the student to
 * emulate failure-then-fake-completion. Strictly tighter than the harness
 * invariants: this is the last line of defense before bytes become training
 * input. (Round 1 review C1.)
 *
 * Payload shape note: `RunFinished` serializes payload as `[status, summary]`
 * (see `runners/real.ts:70`) so `payload[0]` is the status literal.
 * `ASSERTION_FAILED` payload is `[stepId, message, category, abortReason]`
 * (`runners/real.ts:65`) — we check `payload[2] === "abort"`.
 */
export const isTraceSuccessful = (events: ReadonlyArray<TraceEvent>): boolean => {
  if (hasAssertionAbort(events)) return false;
  const runCompleted = [...events]
    .reverse()
    .map(asStatusMarker)
    .find((marker) => marker !== undefined && marker.marker === "RUN_COMPLETED");
  if (runCompleted === undefined) return false;
  const payload = runCompleted.payload;
  if (!Array.isArray(payload)) return false;
  const status = payload[0];
  return status === "passed";
};

/**
 * isTraceStrictlyClean — R11 P2 strict filter (R10 closure note).
 *
 * Returns true iff:
 *   1. The base `isTraceSuccessful` check passes (RUN_COMPLETED:passed,
 *      no ASSERTION_FAILED category=abort anywhere).
 *   2. A sidecar score record was written next to the trace by
 *      `scripts/wave-r5-ab/build-report.ts` (fail-closed when missing —
 *      legacy traces without sidecars are rejected, not status-only-fallback).
 *   3. `sidecar.status === "passed"`.
 *   4. `sidecar.finalState === 1.0` (full final-state assertion match).
 *   5. `sidecar.stepCoverage === 1.0` (every key-node hit).
 *
 * Why three criteria, not just status: gemini-3-pro-preview's
 * stopping-criterion has two distinct failure shapes (per
 * `docs/handover/teacher-viability/diary/r10-2026-04-30.md`):
 *   - **Premature**: declares RUN_COMPLETED:failed before satisfying
 *     finalState (13/20 R10 gemini-react runs). Status-only filter
 *     correctly rejects these — but then we drop traces where Pro
 *     reached more KeyNodes than gemma; throwing away signal.
 *   - **Over-execution**: hits every STEP_DONE then keeps tooling past
 *     the success state, often to MAX_TOOL_ROUNDS. Exemplar:
 *     `calibration-2`. Status-only filter PASSES this case
 *     (RUN_COMPLETED:passed) — but the trajectory teaches the LoRA to
 *     emit envelopes past completion.
 *
 * The three-way conjunction isolates cleanly-shaped teacher data: status
 * eliminates premature, finalState=1.0 blocks any partial-state pass,
 * stepCoverage=1.0 catches over-execution into key-node-overshoot
 * territory (when a clean run would saturate at 1.0, an over-execution
 * still saturates — which is fine; the filter cuts off the long tail
 * but accepts saturated valid traces).
 *
 * R10 closure note's exact phrasing: "Filter for teacher-trace capture:
 * `RUN_COMPLETED:passed AND finalState == 1.0 AND step-coverage == 1.0`,
 * NOT just `passed`." Yields 2/20 traces under R10's gemini-react sweep
 * (calibration-1, trivial-1) — accepted data-scarcity constraint per
 * R11 plan §"Data scarcity dominates".
 */
export const isTraceStrictlyClean = (
  events: ReadonlyArray<TraceEvent>,
  sidecar: SidecarScore | undefined,
): boolean => {
  if (!isTraceSuccessful(events)) return false;
  if (sidecar === undefined) return false;
  if (sidecar.status !== "passed") return false;
  if (sidecar.finalState !== 1) return false;
  if (sidecar.stepCoverage !== 1) return false;
  return true;
};

const includesRedactedKey = (value: unknown, depth: number): boolean => {
  if (depth >= 6) return false;
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => includesRedactedKey(entry, depth + 1));
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEY_PATTERN.test(key)) return true;
    if (includesRedactedKey(entry, depth + 1)) return true;
  }
  return false;
};

/**
 * redactSensitiveKeys — deep-clone `value` replacing the value of any entry
 * whose key matches REDACTED_KEY_PATTERN with the string "[REDACTED]".
 * Structural identity is preserved so downstream consumers still see the key
 * (drops would confuse shape-based decoders), only the sensitive value
 * disappears.
 */
export const redactSensitiveKeys = <T>(value: T): T => redactSensitiveKeysRecursive(value, 0) as T;

const redactSensitiveKeysRecursive = (value: unknown, depth: number): unknown => {
  if (depth >= 8) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveKeysRecursive(entry, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactSensitiveKeysRecursive(entry, depth + 1);
  }
  return result;
};

const parseJsonIfString = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

/**
 * containsSensitiveData — true iff the trace carries a redactable key
 * anywhere in its tool_call or tool_result payloads. Used as a logging hint;
 * redaction still runs unconditionally in the exporter.
 *
 * tool_call `args` and tool_result `result` are stored as JSON strings on the
 * wire schema (`TraceEventSchema`). We parse them back before the deep walk so
 * keys embedded inside the string also trip detection.
 */
export const containsSensitiveData = (events: ReadonlyArray<TraceEvent>): boolean =>
  events.some((event) => {
    if (event.type === "tool_call") return includesRedactedKey(parseJsonIfString(event.args), 0);
    if (event.type === "tool_result") {
      return includesRedactedKey(parseJsonIfString(event.result), 0);
    }
    return false;
  });
