import { createSignal, createContext, useContext, type JSX } from "solid-js";
import * as Data from "effect/Data";
import type { ChangesFor, SavedFlow, PerfReport } from "@neuve/shared/models";
import type { DevServerHint } from "@neuve/shared/prompts";
import { containsUrl } from "../utils/detect-url";

export type Screen = Data.TaggedEnum<{
  Startup: {};
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

export type ResultsOverlay = "insights" | "rawEvents" | "ask";

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

interface NavigationContextValue {
  readonly currentScreen: () => Screen;
  readonly previousScreen: () => Screen;
  readonly navigateTo: (screen: Screen) => void;
  readonly setScreen: (screen: Screen) => void;
  readonly overlay: () => ResultsOverlay | undefined;
  readonly setOverlay: (overlay: ResultsOverlay | undefined) => void;
}

const NavigationContext = createContext<NavigationContextValue>();

export const useNavigation = (): NavigationContextValue => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used inside NavigationProvider");
  }
  return context;
};

interface NavigationProviderProps {
  readonly children: JSX.Element;
}

export const NavigationProvider = (props: NavigationProviderProps) => {
  const [currentScreen, setCurrentScreen] = createSignal<Screen>(Screen.Startup());
  const [previousScreen, setPreviousScreen] = createSignal<Screen>(Screen.Startup());
  const [overlay, setOverlay] = createSignal<ResultsOverlay | undefined>(undefined);

  const navigateTo = (screen: Screen) => {
    setPreviousScreen(currentScreen());
    setCurrentScreen(screen);
    setOverlay(undefined);
  };

  const setScreen = (screen: Screen) => {
    setCurrentScreen(screen);
    setOverlay(undefined);
  };

  const value: NavigationContextValue = {
    currentScreen,
    previousScreen,
    navigateTo,
    setScreen,
    overlay,
    setOverlay,
  };

  return <NavigationContext.Provider value={value}>{props.children}</NavigationContext.Provider>;
};
