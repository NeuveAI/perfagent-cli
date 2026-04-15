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

interface NavigationStore {
  screen: Screen;
  previousScreen: Screen;
  /** Set when a screen has an overlay open that wants to handle `esc` locally
   * (e.g. the drill-in view on the Results screen). While true, the global
   * `esc → goBack` handler in app.tsx must not fire, otherwise the screen gets
   * unmounted underneath the overlay's own close action. */
  overlayOpen: boolean;
  navigateTo: (screen: Screen) => void;
  setScreen: (screen: Screen) => void;
  setOverlayOpen: (open: boolean) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  screen: Screen.Main(),
  previousScreen: Screen.Main(),
  overlayOpen: false,
  navigateTo: (screen) =>
    set((state) => ({ screen, previousScreen: state.screen, overlayOpen: false })),
  setScreen: (screen) => set({ screen, overlayOpen: false }),
  setOverlayOpen: (open) => set({ overlayOpen: open }),
}));
