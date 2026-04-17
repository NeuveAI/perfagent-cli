import type { CommandDef } from "../context/command";
import type { Screen, ResultsOverlay } from "../context/navigation";
import { getResultsActions } from "../routes/results/results-screen";

interface RegisterResultsOptions {
  readonly currentScreen: () => Screen;
  readonly overlay: () => ResultsOverlay | undefined;
  readonly isDialogEmpty: () => boolean;
  readonly setOverlay: (overlay: ResultsOverlay | undefined) => void;
}

const isEnabled = (options: RegisterResultsOptions): boolean =>
  options.currentScreen()._tag === "Results" &&
  options.overlay() === undefined &&
  options.isDialogEmpty();

export const createResultsCommands = (options: RegisterResultsOptions): readonly CommandDef[] => [
  {
    title: "copy",
    value: "results.copy",
    keybind: "y",
    category: "Results",
    enabled: isEnabled(options),
    onSelect: () => {
      getResultsActions()?.onCopy();
    },
  },
  {
    title: "save flow",
    value: "results.save",
    keybind: "s",
    category: "Results",
    enabled: isEnabled(options),
    onSelect: () => {
      getResultsActions()?.onSave();
    },
  },
  {
    title: "restart",
    value: "results.restart",
    keybind: "r",
    category: "Results",
    enabled: isEnabled(options),
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
    enabled: isEnabled(options),
    onSelect: () => {
      // HACK: stub — follow-up questions are future work
    },
  },
  {
    title: "insights",
    value: "results.insights",
    keybind: "i",
    category: "Results",
    enabled: isEnabled(options),
    onSelect: () => {
      options.setOverlay("insights");
    },
  },
  {
    title: "events",
    value: "results.raw-events",
    keybind: "e",
    category: "Results",
    enabled: isEnabled(options),
    onSelect: () => {
      options.setOverlay("rawEvents");
    },
  },
];
