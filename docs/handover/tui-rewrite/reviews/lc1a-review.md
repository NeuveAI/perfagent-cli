# Review: LC-1a — Error Parser Utility

## Verdict: APPROVE

### Verification

- **tsc**: `bunx tsc --noEmit` in `apps/cli-solid` — passes with no errors.
- **Tests**: `bun test tests/utils/parse-execution-error.test.ts` — 13/13 pass, 39 assertions, 0 failures.
- **Effect v4 API**: `Cause.isFailReason` confirmed at `node_modules/effect/src/Cause.ts:233` (since 4.0.0). `cause.reasons` confirmed as `ReadonlyArray<Reason<E>>` at `Cause.ts:141`. The `Fail<E>.error` property exists at `Cause.ts:406`. All APIs are correct and match the documented usage patterns in the Effect source (e.g., `cause.reasons.filter(Cause.isFailReason)` is shown in the module-level docstring at line 60).

### Findings

- [Minor] `String(error.cause)` produces `"[object Object]"` when cause is a non-string object (parse-execution-error.ts:27). This is harmless because the "Connection closed" text is always present in `error.message` (the `AcpSessionCreateError.message` getter interpolates `cause.message` or `String(cause)` at `acp-client.ts:161`), so the detection succeeds via the message part of the concatenation. However, the `causeText` construction is misleading — it suggests both halves contribute to detection when in practice only `error.message` reliably carries the substring. Consider checking `error.message` alone to make intent clearer.

### Suggestions (non-blocking)

- The implementation adds `AcpProviderUsageLimitError` (line 70-74) which is not in the spec's pattern-match table. This is good extra coverage — just noting the deviation for completeness.
- The `TaggedError` interface (line 11-16) declares `reason?: TaggedError` but the real `ExecutionError.reason` is a typed union of `AcpStreamError | AcpSessionCreateError | AcpProviderUnauthenticatedError | AcpProviderUsageLimitError` (executor.ts:44-49). The loose typing is fine since `isTaggedError` runtime-checks `_tag`, but a code comment explaining this is a "structural duck-type for runtime pattern matching, not a 1:1 model of the error hierarchy" could help future readers. (Though per project style rules, comments are only for hacks, so this is very optional.)
- The `isTaggedError` type guard (line 18-19) is sound: `typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"` correctly narrows. No unsafe casts.
- Test coverage is thorough: all 8 error tags tested, both `AcpSessionCreateError` variants (Connection closed string cause at line 64, object cause at line 6), `ExecutionError` unwrapping (line 52, line 64), unknown tag fallback (line 124), non-tagged cause fallback (line 135), and truncation (line 142).
