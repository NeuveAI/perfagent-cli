/**
 * InsightEnricher — scaffolded but not wired into the run pipeline as of writing.
 *
 * The enricher calls `performance_analyze_insight` via DevToolsClient for every
 * insight ref the reporter did not already drill into. The implementation is
 * correct and tested, but relying on it today does not populate insight bodies:
 * DevToolsClient.layer spawns a fresh chrome-devtools-mcp subprocess inside the
 * CLI process, separate from the agent's subprocess where the trace was
 * recorded. The `insightSetId`s from the agent's trace do not exist in the
 * enricher's session, so every call returns a DevToolsToolError and the
 * enricher gracefully returns the report unchanged.
 *
 * Primary path for insight drill-ins is the agent itself
 * (see LOCAL_AGENT_SYSTEM_PROMPT — it mandates per-insight analyze calls in
 * the agent's own live session where the insightSetIds are valid). The
 * enricher is kept in-tree so that when shared-session support lands
 * (agent and CLI sharing a DevTools daemon), wiring is a one-line change.
 *
 * Call sites that intentionally skip this service:
 * - apps/cli/src/data/execution-atom.ts  (TUI path)
 * - apps/cli/src/utils/run-test.ts       (headless path)
 */
import { DateTime, Effect, Layer, Option, ServiceMap } from "effect";
import { DevToolsClient } from "@neuve/devtools";
import { InsightDetail, PerfReport } from "@neuve/shared/models";
import { parseInsightDetail } from "@neuve/shared/parse-insight-detail";

interface MissingInsightRef {
  readonly insightSetId: string;
  readonly insightName: string;
}

const makeDedupeKey = (insightSetId: string, insightName: string): string =>
  `${insightSetId}::${insightName}`;

const collectMissingRefs = (report: PerfReport): readonly MissingInsightRef[] => {
  const existingKeys = new Set<string>();
  const existingNames = new Set<string>();
  for (const detail of report.insightDetails) {
    const setIdOption = detail.insightSetId;
    if (Option.isSome(setIdOption)) {
      existingKeys.add(makeDedupeKey(setIdOption.value, detail.insightName));
    } else {
      existingNames.add(detail.insightName);
    }
  }

  const seen = new Set<string>();
  const missing: MissingInsightRef[] = [];
  for (const snapshot of report.metrics) {
    for (const insight of snapshot.traceInsights) {
      const key = makeDedupeKey(insight.insightSetId, insight.insightName);
      if (seen.has(key)) continue;
      seen.add(key);
      if (existingKeys.has(key)) continue;
      if (existingNames.has(insight.insightName)) continue;
      missing.push({
        insightSetId: insight.insightSetId,
        insightName: insight.insightName,
      });
    }
  }
  return missing;
};

export class InsightEnricher extends ServiceMap.Service<InsightEnricher>()(
  "@supervisor/InsightEnricher",
  {
    make: Effect.gen(function* () {
      const devtools = yield* DevToolsClient;

      const analyzeOne = Effect.fn("InsightEnricher.analyzeOne")(function* (
        ref: MissingInsightRef,
      ) {
        yield* Effect.annotateCurrentSpan({
          insightSetId: ref.insightSetId,
          insightName: ref.insightName,
        });

        const result = yield* devtools.callTool("performance_analyze_insight", {
          insightSetId: ref.insightSetId,
          insightName: ref.insightName,
        });

        const text = result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n");

        const parsed = parseInsightDetail(text);
        if (!parsed) {
          yield* Effect.logWarning("Insight analysis returned unparseable output", {
            insightSetId: ref.insightSetId,
            insightName: ref.insightName,
          });
          return Option.none<InsightDetail>();
        }

        const collectedAt = yield* DateTime.now;
        const detail = new InsightDetail({
          insightSetId: Option.some(ref.insightSetId),
          insightName: parsed.insightName,
          title: parsed.title,
          summary: parsed.summary,
          analysis: parsed.analysis,
          estimatedSavings:
            parsed.estimatedSavings === undefined
              ? Option.none()
              : Option.some(parsed.estimatedSavings),
          externalResources: parsed.externalResources,
          collectedAt,
        });

        yield* Effect.logDebug("Insight enriched", {
          insightSetId: ref.insightSetId,
          insightName: parsed.insightName,
        });

        return Option.some(detail);
      });

      const analyzeSafe = (ref: MissingInsightRef) =>
        analyzeOne(ref).pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            Effect.logWarning("Insight analysis failed", {
              insightSetId: ref.insightSetId,
              insightName: ref.insightName,
              tool: error.tool,
              cause: error.cause,
            }).pipe(Effect.as(Option.none<InsightDetail>())),
          ),
        );

      const enrich = Effect.fn("InsightEnricher.enrich")(function* (report: PerfReport) {
        const missing = collectMissingRefs(report);

        if (missing.length === 0) {
          yield* Effect.logDebug("No insights need enrichment", {
            existingDetailCount: report.insightDetails.length,
          });
          return report;
        }

        yield* Effect.logInfo("Enriching insight details", {
          missingCount: missing.length,
          existingDetailCount: report.insightDetails.length,
        });

        const results = yield* Effect.forEach(missing, (ref) => analyzeSafe(ref), {
          concurrency: 1,
        });

        const appended: InsightDetail[] = [];
        for (const result of results) {
          if (Option.isSome(result)) appended.push(result.value);
        }

        if (appended.length === 0) {
          yield* Effect.logWarning("Insight enrichment produced no new details", {
            missingCount: missing.length,
          });
          return report;
        }

        const enriched = new PerfReport({
          ...report,
          insightDetails: [...report.insightDetails, ...appended],
        });

        yield* Effect.logInfo("Insight enrichment complete", {
          added: appended.length,
          totalDetailCount: enriched.insightDetails.length,
        });

        return enriched;
      });

      return { enrich } as const;
    }),
  },
) {
  static layer = Layer.effect(this)(this.make);
}
