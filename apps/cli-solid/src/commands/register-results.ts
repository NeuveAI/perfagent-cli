import type { CommandDef } from "../context/command";
import type { Screen } from "../context/navigation";
import { getResultsActions } from "../routes/results/results-screen";

interface RegisterResultsOptions {
  readonly currentScreen: () => Screen;
}

const isResultsScreen = (currentScreen: () => Screen): boolean =>
  currentScreen()._tag === "Results";

export const createResultsCommands = (options: RegisterResultsOptions): readonly CommandDef[] => [
  {
    title: "copy",
    value: "results.copy",
    keybind: "y",
    category: "Results",
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      getResultsActions()?.onCopy();
    },
  },
  {
    title: "save flow",
    value: "results.save",
    keybind: "s",
    category: "Results",
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      getResultsActions()?.onSave();
    },
  },
  {
    title: "restart",
    value: "results.restart",
    keybind: "r",
    category: "Results",
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      getResultsActions()?.onRestart();
    },
  },
  {
    title: "ask",
    value: "results.ask",
    keybind: "a",
    category: "Results",
    hidden: true,
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      // HACK: stub — follow-up questions are future work
    },
  },
  {
    title: "insights",
    value: "results.insights",
    keybind: "i",
    category: "Results",
    hidden: true,
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      // HACK: stub — insight panel is future work
    },
  },
  {
    title: "raw events",
    value: "results.raw-events",
    keybind: "ctrl+o",
    category: "Results",
    hidden: true,
    enabled: isResultsScreen(options.currentScreen),
    onSelect: () => {
      // HACK: stub — raw events panel is future work
    },
  },
];
