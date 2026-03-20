import { Schema } from "effect";
import { DEFAULT_AGENT_PROVIDER, FLOW_GENERATION_MAX_EVENTS } from "./constants";
import { createAgentModel } from "./create-agent-model";
import type { BrowserRunEvent } from "./events";
import { extractJsonObject } from "./json";
import type { AgentProvider, FlowStep, BrowserRunReport, TestTarget } from "./types";

export interface GeneratedFlow {
  title: string;
  steps: readonly FlowStep[];
}

export interface GenerateFlowOptions {
  cwd: string;
  events: BrowserRunEvent[];
  report: BrowserRunReport;
  userInstruction: string;
  target: TestTarget;
  provider?: AgentProvider;
  signal?: AbortSignal;
}

const FlowStepSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  instruction: Schema.String,
  expectedOutcome: Schema.String,
});
const GeneratedFlowSchema = Schema.Struct({
  title: Schema.String,
  steps: Schema.Array(FlowStepSchema),
});

const formatEventForFlow = (event: BrowserRunEvent): string | null => {
  switch (event.type) {
    case "step-started":
      return `step-started: ${event.stepId} ${event.title}`;
    case "step-completed":
      return `step-completed: ${event.stepId} ${event.summary}`;
    case "assertion-failed":
      return `assertion-failed: ${event.stepId} ${event.message}`;
    case "browser-log":
      return `browser-log: ${event.action} ${event.message}`;
    case "run-completed":
      return `run-completed: ${event.status} ${event.summary}`;
    default:
      return null;
  }
};

const buildFlowPrompt = (options: GenerateFlowOptions): string => {
  const serializedEvents = options.events
    .slice(-FLOW_GENERATION_MAX_EVENTS)
    .map(formatEventForFlow)
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const serializedSteps = options.report.stepResults
    .map((stepResult) => `- ${stepResult.title}: ${stepResult.summary}`)
    .join("\n");

  return [
    "You are generating a reusable saved browser flow from a completed browser test run.",
    "Produce the clean deterministic flow a developer would want to save for future reuse.",
    "",
    "Requirements:",
    "- Keep the happy path only.",
    "- Remove retries, debugging, diagnostics, and recovery detours.",
    "- Keep steps concrete enough for a future browser agent to follow.",
    "- Each step must include id, title, instruction, and expectedOutcome.",
    "- Use stable sequential ids like step-01, step-02, step-03.",
    "- Title the flow for the user-facing journey, not the internal file diff.",
    "",
    "Return JSON only with this shape:",
    '{ "title": string, "steps": [{ "id": string, "title": string, "instruction": string, "expectedOutcome": string }] }',
    "",
    "Target context:",
    `- Scope: ${options.target.scope}`,
    `- Display name: ${options.target.displayName}`,
    "",
    "Original user instruction:",
    options.userInstruction,
    "",
    "Run report summary:",
    `- Status: ${options.report.status}`,
    `- Summary: ${options.report.summary}`,
    "",
    "Observed step results:",
    serializedSteps,
    "",
    "Selected run events:",
    serializedEvents || "No events recorded.",
  ].join("\n");
};

export const generateFlow = async (options: GenerateFlowOptions): Promise<GeneratedFlow> => {
  const provider = options.provider ?? DEFAULT_AGENT_PROVIDER;
  const model = createAgentModel(provider, {
    cwd: options.cwd,
    effort: "low",
    maxTurns: 1,
    tools: [],
  });
  const response = await model.doGenerate({
    abortSignal: options.signal,
    prompt: [
      {
        role: "user",
        content: [{ type: "text", text: buildFlowPrompt(options) }],
      },
    ],
  });
  const text = response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  try {
    return Schema.decodeUnknownSync(GeneratedFlowSchema)(JSON.parse(extractJsonObject(text)));
  } catch (cause) {
    throw new Error(
      `Failed to parse generated flow: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};
