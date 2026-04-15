import { Effect, Option, Schema, Stream } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Agent, AgentStreamOptions } from "@neuve/agent";
import { GitRepoRoot } from "@neuve/supervisor";
import { AcpAgentMessageChunk, PerfReport } from "@neuve/shared/models";
import { cliAtomRuntime } from "./runtime";
import * as NodeServices from "@effect/platform-node/NodeServices";

const ASK_JSON_CHAR_BUDGET = 8192;
const ASK_INSIGHT_ANALYSIS_CHAR_LIMIT = 1500;
const ASK_INSIGHT_ANALYSIS_TIGHT_CHAR_LIMIT = 600;
const ASK_INSIGHT_MAX_EXTERNAL_RESOURCES = 3;
const ASK_CONSOLE_MAX_ENTRIES = 30;
const ASK_CONSOLE_TIGHT_MAX_ENTRIES = 10;
const ASK_NETWORK_MAX_HEAD = 20;
const ASK_NETWORK_MAX_TAIL = 20;
const ASK_NETWORK_TIGHT_MAX_HEAD = 5;
const ASK_NETWORK_TIGHT_MAX_TAIL = 5;

const ASK_SYSTEM_PROMPT = [
  "You are answering a follow-up question about a previously captured performance analysis.",
  "You MUST answer ONLY from the data in the report provided in the user message.",
  "Do not suggest re-running the trace and do not call any tools — the Chrome session has been torn down.",
  "If the answer isn't in the data, say so explicitly and recommend a re-run for that specific follow-up.",
  "Keep your answer concise and actionable. Use plain text, not markdown headings.",
].join(" ");

const truncateString = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}... (truncated, original ${text.length} chars)`;
};

// Narrowing helpers — concentrate every unavoidable `as` cast in one place so
// the rest of the condensation walker stays cast-free.
const EMPTY_RECORD: Record<string, unknown> = {};
const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return EMPTY_RECORD;
  return value as Record<string, unknown>;
};
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asStringArray = (value: unknown): readonly string[] =>
  asArray(value).filter((entry): entry is string => typeof entry === "string");

interface CondensedInsight {
  readonly insightName: string;
  readonly title: string;
  readonly summary: string;
  readonly analysis: string;
  readonly estimatedSavings: string;
  readonly externalResources: readonly string[];
}

interface CondensedConsoleCapture {
  readonly url: string;
  readonly totalEntries: number;
  readonly tailEntries: readonly unknown[];
}

interface CondensedNetworkCapture {
  readonly url: string;
  readonly totalRequests: number;
  readonly failedRequests: number;
  readonly headRequests: readonly unknown[];
  readonly tailRequests: readonly unknown[];
  readonly failedRequestDetails: readonly unknown[];
}

interface CondensedReport {
  readonly title: string;
  readonly status: string;
  readonly instruction: string;
  readonly targetUrls: readonly string[];
  readonly summary: string;
  readonly metrics: unknown;
  readonly regressions: unknown;
  readonly insightDetails: readonly CondensedInsight[];
  readonly consoleCaptures: readonly CondensedConsoleCapture[];
  readonly networkCaptures: readonly CondensedNetworkCapture[];
}

interface CondenseBudgets {
  readonly analysisChars: number;
  readonly consoleEntries: number;
  readonly networkHead: number;
  readonly networkTail: number;
}

const NORMAL_BUDGETS: CondenseBudgets = {
  analysisChars: ASK_INSIGHT_ANALYSIS_CHAR_LIMIT,
  consoleEntries: ASK_CONSOLE_MAX_ENTRIES,
  networkHead: ASK_NETWORK_MAX_HEAD,
  networkTail: ASK_NETWORK_MAX_TAIL,
};

const TIGHT_BUDGETS: CondenseBudgets = {
  analysisChars: ASK_INSIGHT_ANALYSIS_TIGHT_CHAR_LIMIT,
  consoleEntries: ASK_CONSOLE_TIGHT_MAX_ENTRIES,
  networkHead: ASK_NETWORK_TIGHT_MAX_HEAD,
  networkTail: ASK_NETWORK_TIGHT_MAX_TAIL,
};

const condenseInsight = (raw: unknown, budgets: CondenseBudgets): CondensedInsight => {
  const detail = asRecord(raw);
  return {
    insightName: asString(detail["insightName"]),
    title: asString(detail["title"]),
    summary: asString(detail["summary"]),
    analysis: truncateString(asString(detail["analysis"]), budgets.analysisChars),
    estimatedSavings: asString(detail["estimatedSavings"]),
    externalResources: asStringArray(detail["externalResources"]).slice(
      0,
      ASK_INSIGHT_MAX_EXTERNAL_RESOURCES,
    ),
  };
};

const condenseConsoleCapture = (
  raw: unknown,
  budgets: CondenseBudgets,
): CondensedConsoleCapture => {
  const capture = asRecord(raw);
  const entries = asArray(capture["entries"]);
  return {
    url: asString(capture["url"]),
    totalEntries: entries.length,
    tailEntries: entries.slice(-budgets.consoleEntries),
  };
};

const condenseNetworkCapture = (
  raw: unknown,
  budgets: CondenseBudgets,
): CondensedNetworkCapture => {
  const capture = asRecord(raw);
  const requests = asArray(capture["requests"]);
  const failed = requests.filter((request) => asRecord(request)["failed"] === true);
  const totalRequests = requests.length;
  const headCount = Math.min(budgets.networkHead, totalRequests);
  const tailStart = Math.max(headCount, totalRequests - budgets.networkTail);
  return {
    url: asString(capture["url"]),
    totalRequests,
    failedRequests: failed.length,
    headRequests: requests.slice(0, headCount),
    tailRequests: totalRequests > tailStart ? requests.slice(tailStart) : [],
    failedRequestDetails: failed,
  };
};

const condenseEncodedReport = (
  encodedReport: unknown,
  budgets: CondenseBudgets,
): CondensedReport => {
  const report = asRecord(encodedReport);
  return {
    title: asString(report["title"]),
    status: asString(report["status"]),
    instruction: asString(report["instruction"]),
    targetUrls: asStringArray(report["targetUrls"]),
    summary: asString(report["summary"]),
    metrics: report["metrics"] ?? [],
    regressions: report["regressions"] ?? [],
    insightDetails: asArray(report["insightDetails"]).map((raw) =>
      condenseInsight(raw, budgets),
    ),
    consoleCaptures: asArray(report["consoleCaptures"]).map((raw) =>
      condenseConsoleCapture(raw, budgets),
    ),
    networkCaptures: asArray(report["networkCaptures"]).map((raw) =>
      condenseNetworkCapture(raw, budgets),
    ),
  };
};

const buildReportJson = (report: PerfReport): string => {
  const encoded: unknown = Schema.encodeSync(PerfReport)(report);
  const fullJson = JSON.stringify(encoded, undefined, 2);
  if (fullJson.length <= ASK_JSON_CHAR_BUDGET) return fullJson;

  const normal = condenseEncodedReport(encoded, NORMAL_BUDGETS);
  const normalJson = JSON.stringify(normal, undefined, 2);
  if (normalJson.length <= ASK_JSON_CHAR_BUDGET) return normalJson;

  // Still over budget (e.g. many insights each carrying ~1500 chars of analysis).
  // Tighten aggressively. If even the tight shape is too big, ship it anyway
  // rather than drop fields silently — the system prompt handles "data not present".
  const tight = condenseEncodedReport(encoded, TIGHT_BUDGETS);
  return JSON.stringify(tight, undefined, 2);
};

const buildAskPrompt = (report: PerfReport, question: string): string => {
  const reportJson = buildReportJson(report);
  const plainText = report.toPlainText;
  return [
    "Report JSON:",
    "```json",
    reportJson,
    "```",
    "",
    "Report summary (human readable):",
    "```",
    plainText,
    "```",
    "",
    `Question: ${question}`,
  ].join("\n");
};

interface AskInput {
  readonly report: PerfReport;
  readonly question: string;
}

export interface AskResult {
  readonly question: string;
  readonly answer: string;
}

export const askReportFn = cliAtomRuntime.fn(
  Effect.fnUntraced(
    function* (input: AskInput, _ctx: Atom.FnContext) {
      const agent = yield* Agent;
      const repoRoot = yield* GitRepoRoot;

      yield* Effect.logInfo("Ask-mode follow-up started", {
        questionLength: input.question.length,
        reportId: input.report.id,
      });

      const prompt = buildAskPrompt(input.report, input.question);

      const streamOptions = new AgentStreamOptions({
        cwd: repoRoot,
        sessionId: Option.none(),
        prompt,
        systemPrompt: Option.some(ASK_SYSTEM_PROMPT),
        mcpEnv: [],
      });

      const answer: string = yield* agent.stream(streamOptions).pipe(
        Stream.filter(
          (update): update is AcpAgentMessageChunk =>
            update.sessionUpdate === "agent_message_chunk",
        ),
        Stream.map((update) => (update.content.type === "text" ? update.content.text : "")),
        Stream.runFold(
          () => "",
          (accumulated: string, chunk: string) => accumulated + chunk,
        ),
      );

      yield* Effect.logInfo("Ask-mode follow-up completed", {
        answerLength: answer.length,
      });

      return { question: input.question, answer: answer.trim() } satisfies AskResult;
    },
    Effect.annotateLogs({ fn: "askReportFn" }),
    Effect.provide(NodeServices.layer),
  ),
);
