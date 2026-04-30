import { Effect, Schema } from "effect";

const PlanUpdateAction = Schema.Literals(["insert", "replace", "remove", "replace_step"] as const);
export type PlanUpdateAction = typeof PlanUpdateAction.Type;

const AssertionFailedCategory = Schema.Literals([
  "budget-violation",
  "regression",
  "resource-blocker",
  "memory-leak",
  "abort",
] as const);
export type AssertionFailedCategory = typeof AssertionFailedCategory.Type;

const AssertionFailedDomain = Schema.Literals([
  "design",
  "responsive",
  "perf",
  "a11y",
  "other",
] as const);
export type AssertionFailedDomain = typeof AssertionFailedDomain.Type;

const RunCompletedStatus = Schema.Literals(["passed", "failed"] as const);
export type RunCompletedStatus = typeof RunCompletedStatus.Type;

export class Thought extends Schema.TaggedClass<Thought>()("THOUGHT", {
  stepId: Schema.String,
  thought: Schema.String,
}) {}

// R7 — Strict per-tool args schemas. Each leaf has a `description` annotation
// so Gemini's structured-output decoder gets the same signal browser-use
// #104 fix relied on. The dispatcher tools (`interact`/`observe`/`trace`)
// accept BOTH canonical (`{action: {command, ...}}`) and shorthand
// (`{command, ...}`) shapes — gemma emits shorthand verbatim and the
// MCP-bridge auto-wrap at `packages/local-agent/src/mcp-bridge.ts` normalizes
// to canonical at call-time. The flat tools (`click`/`fill`/`hover`/`select`/
// `wait_for`) use a direct args struct mirroring
// `packages/browser/src/mcp/tools/interactions.ts`.

const describe = <S>(schema: S, description: string): S =>
  (schema as { pipe: (fn: unknown) => S }).pipe(Schema.annotate({ description }));

const InteractNavigate = Schema.Struct({
  command: describe(
    Schema.Literal("navigate"),
    "Navigate the active page. Use `url` for fresh navigations or `direction` for back/forward/reload.",
  ),
  url: Schema.optional(
    describe(
      Schema.String,
      'Target URL for `direction: "url"` navigations. Must be a valid absolute URL.',
    ),
  ),
  direction: Schema.optional(
    describe(
      Schema.Literals(["url", "back", "forward", "reload"] as const),
      "Navigation kind. Defaults to `url` when `url` is provided.",
    ),
  ),
  ignoreCache: Schema.optional(Schema.Boolean),
  handleBeforeUnload: Schema.optional(Schema.Literals(["accept", "decline"] as const)),
  initScript: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
});

const InteractClick = Schema.Struct({
  command: Schema.Literal("click"),
  uid: describe(
    Schema.String,
    "Element UID returned by `observe.snapshot` (the accessibility-tree row label).",
  ),
  double: Schema.optional(Schema.Boolean),
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractType = Schema.Struct({
  command: Schema.Literal("type"),
  text: describe(Schema.String, "Literal text to type into the focused element."),
  submitKey: Schema.optional(Schema.String),
});

const InteractFill = Schema.Struct({
  command: Schema.Literal("fill"),
  uid: describe(Schema.String, "Element UID returned by `observe.snapshot`."),
  value: describe(Schema.String, "Value to write into the input field."),
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractPressKey = Schema.Struct({
  command: Schema.Literal("press_key"),
  key: describe(Schema.String, "Keyboard key name, e.g. `Enter` or `Tab`."),
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractHover = Schema.Struct({
  command: Schema.Literal("hover"),
  uid: describe(Schema.String, "Element UID returned by `observe.snapshot`."),
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractDrag = Schema.Struct({
  command: Schema.Literal("drag"),
  fromUid: Schema.String,
  toUid: Schema.String,
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractFillFormElement = Schema.Struct({
  uid: Schema.String,
  value: Schema.String,
});

const InteractFillForm = Schema.Struct({
  command: Schema.Literal("fill_form"),
  elements: Schema.Array(InteractFillFormElement),
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractUploadFile = Schema.Struct({
  command: Schema.Literal("upload_file"),
  uid: Schema.String,
  filePath: Schema.String,
  includeSnapshot: Schema.optional(Schema.Boolean),
});

const InteractHandleDialog = Schema.Struct({
  command: Schema.Literal("handle_dialog"),
  accept: Schema.Boolean,
  promptText: Schema.optional(Schema.String),
});

const InteractWaitFor = Schema.Struct({
  command: Schema.Literal("wait_for"),
  text: describe(
    Schema.Array(Schema.String),
    "List of substrings to wait for in the page. Non-empty.",
  ),
  timeout: Schema.optional(Schema.Number),
});

const InteractResize = Schema.Struct({
  command: Schema.Literal("resize"),
  width: Schema.Number,
  height: Schema.Number,
});

const InteractNewTab = Schema.Struct({
  command: Schema.Literal("new_tab"),
  url: Schema.String,
  background: Schema.optional(Schema.Boolean),
  isolatedContext: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
});

const InteractSwitchTab = Schema.Struct({
  command: Schema.Literal("switch_tab"),
  pageId: Schema.Number,
  bringToFront: Schema.optional(Schema.Boolean),
});

const InteractCloseTab = Schema.Struct({
  command: Schema.Literal("close_tab"),
  pageId: Schema.Number,
});

const InteractCommand = Schema.Union([
  InteractNavigate,
  InteractClick,
  InteractType,
  InteractFill,
  InteractPressKey,
  InteractHover,
  InteractDrag,
  InteractFillForm,
  InteractUploadFile,
  InteractHandleDialog,
  InteractWaitFor,
  InteractResize,
  InteractNewTab,
  InteractSwitchTab,
  InteractCloseTab,
]);

const InteractArgs = Schema.Union([
  Schema.Struct({
    action: describe(
      InteractCommand,
      "Discriminated command for the interact dispatcher. Choose one of the listed verbs.",
    ),
  }),
  InteractCommand,
]);

const ObserveSnapshot = Schema.Struct({
  command: Schema.Literal("snapshot"),
  verbose: Schema.optional(Schema.Boolean),
  filePath: Schema.optional(Schema.String),
});

const ObserveScreenshot = Schema.Struct({
  command: Schema.Literal("screenshot"),
  format: Schema.optional(Schema.Literals(["png", "jpeg", "webp"] as const)),
  quality: Schema.optional(Schema.Number),
  uid: Schema.optional(Schema.String),
  fullPage: Schema.optional(Schema.Boolean),
  filePath: Schema.optional(Schema.String),
});

const ObserveConsole = Schema.Struct({
  command: Schema.Literal("console"),
  msgid: Schema.optional(Schema.Number),
  types: Schema.optional(Schema.Array(Schema.String)),
  pageSize: Schema.optional(Schema.Number),
  pageIdx: Schema.optional(Schema.Number),
  includePreservedMessages: Schema.optional(Schema.Boolean),
});

const ObserveNetwork = Schema.Struct({
  command: Schema.Literal("network"),
  reqid: Schema.optional(Schema.Number),
  resourceTypes: Schema.optional(Schema.Array(Schema.String)),
  pageSize: Schema.optional(Schema.Number),
  pageIdx: Schema.optional(Schema.Number),
  includePreservedRequests: Schema.optional(Schema.Boolean),
  requestFilePath: Schema.optional(Schema.String),
  responseFilePath: Schema.optional(Schema.String),
});

const ObservePages = Schema.Struct({
  command: Schema.Literal("pages"),
});

const ObserveEvaluate = Schema.Struct({
  command: Schema.Literal("evaluate"),
  function: describe(
    Schema.String,
    "JavaScript expression evaluated in the page context. Use `interact` for user actions when possible.",
  ),
  args: Schema.optional(Schema.Array(Schema.String)),
});

const ObserveCommand = Schema.Union([
  ObserveSnapshot,
  ObserveScreenshot,
  ObserveConsole,
  ObserveNetwork,
  ObservePages,
  ObserveEvaluate,
]);

const ObserveArgs = Schema.Union([
  Schema.Struct({
    action: describe(
      ObserveCommand,
      "Discriminated command for the observe dispatcher. Read-only operations.",
    ),
  }),
  ObserveCommand,
]);

const TraceStart = Schema.Struct({
  command: Schema.Literal("start"),
  reload: Schema.optional(Schema.Boolean),
  autoStop: Schema.optional(Schema.Boolean),
  filePath: Schema.optional(Schema.String),
});

const TraceStop = Schema.Struct({
  command: Schema.Literal("stop"),
  filePath: Schema.optional(Schema.String),
});

const TraceAnalyze = Schema.Struct({
  command: Schema.Literal("analyze"),
  insightSetId: describe(
    Schema.String,
    "Insight-set identifier returned by `trace.stop` (e.g. `NAVIGATION_0`).",
  ),
  insightName: describe(
    Schema.String,
    "Insight name returned by `trace.stop` (e.g. `LCPBreakdown`).",
  ),
});

const TraceMemory = Schema.Struct({
  command: Schema.Literal("memory"),
  filePath: Schema.String,
});

const TraceLighthouse = Schema.Struct({
  command: Schema.Literal("lighthouse"),
  mode: Schema.optional(Schema.Literals(["navigation", "snapshot"] as const)),
  device: Schema.optional(Schema.Literals(["desktop", "mobile"] as const)),
  outputDirPath: Schema.optional(Schema.String),
});

const TraceEmulate = Schema.Struct({
  command: Schema.Literal("emulate"),
  cpuThrottling: Schema.optional(Schema.Number),
  network: Schema.optional(
    Schema.Literals(["Offline", "Slow 3G", "Fast 3G", "Slow 4G", "4G"] as const),
  ),
  viewport: Schema.optional(Schema.String),
  colorScheme: Schema.optional(Schema.Literals(["dark", "light", "auto"] as const)),
  geolocation: Schema.optional(Schema.String),
  userAgent: Schema.optional(Schema.String),
});

const TraceCommand = Schema.Union([
  TraceStart,
  TraceStop,
  TraceAnalyze,
  TraceMemory,
  TraceLighthouse,
  TraceEmulate,
]);

const TraceArgs = Schema.Union([
  Schema.Struct({
    action: describe(
      TraceCommand,
      "Discriminated command for the trace dispatcher. Performance-profiling operations.",
    ),
  }),
  TraceCommand,
]);

// Flat tools registered via `registerInteractionTools`. Args are a single
// struct (no `action` wrapper, no discriminator).

const ClickArgs = Schema.Struct({
  ref: describe(
    Schema.String,
    "Snapshot reference string (numbered overlay or chrome-devtools-mcp uid).",
  ),
  button: Schema.optional(Schema.Literals(["left", "right", "middle"] as const)),
  clickCount: Schema.optional(Schema.Number),
});

const FillArgs = Schema.Struct({
  ref: describe(Schema.String, "Snapshot reference string for the input field."),
  text: describe(Schema.String, "Text to fill into the input."),
  clearFirst: Schema.optional(Schema.Boolean),
});

const HoverArgs = Schema.Struct({
  ref: describe(Schema.String, "Snapshot reference string for the element to hover."),
});

const SelectArgs = Schema.Struct({
  ref: Schema.String,
  option: describe(
    Schema.Union([Schema.String, Schema.Number]),
    "Option value (string) or zero-based index (number).",
  ),
});

const WaitForArgs = Schema.Struct({
  ref: Schema.optional(Schema.String),
  selector: Schema.optional(Schema.String),
  aria: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  state: Schema.optional(Schema.Literals(["visible", "hidden", "attached", "detached"] as const)),
});

// The 8 tool surfaces the MCP server registers (`packages/browser/src/mcp/server.ts`).
// `toolName` is constrained to this list so Gemini's structured-output decoder
// physically rejects upstream-catalog hallucinations like `navigate_page` /
// `take_snapshot` / `performance_start_trace` (per
// `docs/research/gemini-investigation/why-gemini-fails.md` §2.1).
const ToolName = Schema.Literals([
  "interact",
  "observe",
  "trace",
  "click",
  "fill",
  "hover",
  "select",
  "wait_for",
] as const);
export type ToolName = typeof ToolName.Type;

// `Action` keeps its `Schema.TaggedClass` identity — `instanceof Action` still
// dispatches correctly in the supervisor reducer + both ReAct loops + the
// trajectory roller. The new `toolName: ToolName` (literal union) and
// `args: ActionVariantArgs` (per-tool union) put structural pressure on
// Gemini's responseSchema so the failure shapes documented in
// `docs/research/gemini-investigation/why-gemini-fails.md` §2.1-§2.3
// (hallucinated tool names, flat-action `{action: "navigate"}`, array-action
// `{action: ["navigate", "..."]}`) get rejected at decode time instead of
// burning a tool round-trip.
const ActionVariantArgs = Schema.Union([
  InteractArgs,
  ObserveArgs,
  TraceArgs,
  ClickArgs,
  FillArgs,
  HoverArgs,
  SelectArgs,
  WaitForArgs,
]);

export class Action extends Schema.TaggedClass<Action>()("ACTION", {
  stepId: Schema.String,
  toolName: ToolName,
  args: ActionVariantArgs,
}) {}

export class PlanUpdate extends Schema.TaggedClass<PlanUpdate>()("PLAN_UPDATE", {
  stepId: Schema.String,
  action: PlanUpdateAction,
  payload: Schema.Unknown,
}) {}

export class StepDone extends Schema.TaggedClass<StepDone>()("STEP_DONE", {
  stepId: Schema.String,
  summary: Schema.String,
}) {}

export class AssertionFailed extends Schema.TaggedClass<AssertionFailed>()("ASSERTION_FAILED", {
  stepId: Schema.String,
  category: AssertionFailedCategory,
  domain: AssertionFailedDomain,
  reason: Schema.String,
  evidence: Schema.String,
  abortReason: Schema.optional(Schema.String),
}) {}

export class RunCompleted extends Schema.TaggedClass<RunCompleted>()("RUN_COMPLETED", {
  status: RunCompletedStatus,
  summary: Schema.String,
  // Optional abort metadata that mirrors `RunFinished.abort` in
  // `@neuve/shared/models`. Set ONLY by runtime synthesizers (e.g. the
  // gemini-react eval runner's early-termination paths) to flag a non-natural
  // exit so the supervisor's `runFinishedSatisfiesGate` short-circuits and
  // emits the terminal envelope downstream instead of waiting for all plan
  // steps to be terminal. Reasons are short kebab-case identifiers
  // (`doom-loop`, `max-rounds`, `unexpected-envelope`) — richer detail goes
  // in `summary`. Models do NOT set this in normal operation; the field is
  // optional precisely to keep the natural happy-path schema unchanged.
  abort: Schema.optional(Schema.Struct({ reason: Schema.String })),
}) {}

export const AgentTurn = Schema.Union([
  Thought,
  Action,
  PlanUpdate,
  StepDone,
  AssertionFailed,
  RunCompleted,
]);
export type AgentTurn = typeof AgentTurn.Type;

// R7 phase 7 — split Ollama (loose) vs Gemini (strict) JSON-schema paths.
// The strict per-tool union above is the right shape for Gemini's
// `responseSchema` (gemini's structured-output decoder honors discriminated
// `args` and physically rejects upstream-catalog hallucinations) but is too
// complex for Ollama's llama.cpp grammar engine: the depth-6 anyOf 27 KB
// schema overwhelms the compiler for ~35% of complex tasks, the model emits
// zero bytes, and `result.content.length === 0` bails the loop before
// progress (full-sweep R7 ev. — 7/20 gemma traces hit this mode). See
// `docs/handover/strict-tool-schema/diary/r7-2026-04-27.md` Phase 6 for
// the empty-content failure trace.
//
// `AgentTurnLoose` mirrors the R5b shape — `args: Schema.Unknown` on the
// Action variant — so Ollama's grammar engine sees a flat, shallow schema.
// Used ONLY by `tool-loop.ts` for the Ollama `format` parameter; runtime
// validation of gemma's emissions still goes through `parseAgentTurn`
// against the strict `AgentTurn` (gemma's typical canonical/shorthand
// shapes are strict-valid; the empty-content failures don't reach the
// parser anyway).
const ActionLooseStruct = Schema.Struct({
  _tag: Schema.tag("ACTION"),
  stepId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
});

export const AgentTurnLoose = Schema.Union([
  Thought,
  ActionLooseStruct,
  PlanUpdate,
  StepDone,
  AssertionFailed,
  RunCompleted,
]);
export type AgentTurnLoose = typeof AgentTurnLoose.Type;

// R7 — `onExcessProperty: "error"` closes the strict-schema gap. Without it,
// Effect's default `"ignore"` mode silently strips excess fields, so a gemini
// malformed payload like `{toolName: "interact", args: {action: "navigate",
// url}}` would decode as the empty WaitForArgs branch (all-optional fields)
// instead of failing. Strict mode forces every variant's required fields to
// be present and rejects extras at runtime — mirrors the
// `additionalProperties: false` Effect emits in JSON Schema, which Gemini's
// structured-output decoder respects.
const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;

const decodeAgentTurnUnknown = Schema.decodeUnknownEffect(AgentTurn);
const decodeAgentTurnFromString = Schema.decodeEffect(Schema.fromJsonString(AgentTurn));

export const parseAgentTurn = Effect.fn("parseAgentTurn")(function* (input: unknown) {
  return yield* decodeAgentTurnUnknown(input, STRICT_PARSE_OPTIONS);
});

export const parseAgentTurnFromString = Effect.fn("parseAgentTurnFromString")(function* (
  input: string,
) {
  return yield* decodeAgentTurnFromString(input, STRICT_PARSE_OPTIONS);
});
