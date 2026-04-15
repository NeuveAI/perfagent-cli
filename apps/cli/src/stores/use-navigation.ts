import { create } from "zustand";
import * as Data from "effect/Data";
import type { ChangesFor, SavedFlow, PerfReport } from "@neuve/shared/models";
import type { DevServerHint } from "@neuve/shared/prompts";
import { containsUrl } from "../utils/detect-url";

export type { DevServerHint } from "@neuve/shared/prompts";

export type Screen = Data.TaggedEnum<{
  Main: {};
  SelectPr: {};
  CookieSyncConfirm: { changesFor?: ChangesFor; instruction?: string; savedFlow?: SavedFlow };
  PortPicker: {
    changesFor: ChangesFor;
    instruction: string;
    savedFlow?: SavedFlow;
    cookieBrowserKeys?: readonly string[];
  };
  Testing: {
    changesFor: ChangesFor;
    instruction: string;
    savedFlow?: SavedFlow;
    cookieBrowserKeys?: readonly string[];
    baseUrls?: readonly string[];
    devServerHints?: readonly DevServerHint[];
  };
  Results: { report: PerfReport; videoUrl?: string };
  SavedFlowPicker: {};
  RecentReportsPicker: {};
  Watch: {
    changesFor: ChangesFor;
    instruction: string;
    cookieBrowserKeys?: readonly string[];
    baseUrl?: string;
  };
  AgentPicker: {};
}>;
export const Screen = Data.taggedEnum<Screen>();

export const screenForTestingOrPortPicker = (props: {
  changesFor: ChangesFor;
  instruction: string;
  savedFlow?: SavedFlow;
  cookieBrowserKeys?: readonly string[];
  baseUrls?: readonly string[];
}): Screen => {
  if (props.baseUrls && props.baseUrls.length > 0) return Screen.Testing(props);
  if (containsUrl(props.instruction)) return Screen.Testing(props);
  return Screen.PortPicker(props);
};

/** Which local overlay a screen is showing. Used by the modeline to render
 * overlay-specific hints and by the global `esc` handler in app.tsx to stay
 * out of the way while the overlay owns its own close action. */
export type ResultsOverlay = "insights" | "rawEvents" | "ask";

interface NavigationStore {
  screen: Screen;
  previousScreen: Screen;
  overlay: ResultsOverlay | undefined;
  navigateTo: (screen: Screen) => void;
  setScreen: (screen: Screen) => void;
  setOverlay: (overlay: ResultsOverlay | undefined) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  screen: Screen.Main(),
  previousScreen: Screen.Main(),
  overlay: undefined,
  navigateTo: (screen) =>
    set((state) => ({ screen, previousScreen: state.screen, overlay: undefined })),
  setScreen: (screen) => set({ screen, overlay: undefined }),
  setOverlay: (overlay) => set({ overlay }),
}));
