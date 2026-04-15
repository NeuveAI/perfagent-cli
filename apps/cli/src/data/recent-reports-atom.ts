import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ReportStorage, type ReportManifest } from "@neuve/supervisor";
import type { PerfReport } from "@neuve/shared/models";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { cliAtomRuntime } from "./runtime";

/** The listing is refreshed by `execution-atom` via `Atom.refresh` after a
 * fresh report is persisted, so the Main-menu banner and ctrl+f picker pick
 * up the new entry without requiring a CLI restart. */
export const recentReportsAtom = cliAtomRuntime.atom(
  Effect.fnUntraced(
    function* (_get: Atom.Context) {
      const reportStorage = yield* ReportStorage;
      const manifests: readonly ReportManifest[] = yield* reportStorage.list();
      yield* Effect.logDebug("Recent reports loaded", { count: manifests.length });
      return manifests;
    },
    Effect.annotateLogs({ fn: "recentReportsAtom" }),
    Effect.provide(NodeServices.layer),
  ),
);

interface LoadReportInput {
  readonly absolutePath: string;
}

export const loadReportFn = cliAtomRuntime.fn(
  Effect.fnUntraced(
    function* (input: LoadReportInput, _ctx: Atom.FnContext) {
      const reportStorage = yield* ReportStorage;
      const report: PerfReport = yield* reportStorage.load(input.absolutePath);
      yield* Effect.logInfo("Report loaded from disk", {
        absolutePath: input.absolutePath,
        reportId: report.id,
      });
      return report;
    },
    Effect.annotateLogs({ fn: "loadReportFn" }),
    Effect.provide(NodeServices.layer),
  ),
);
