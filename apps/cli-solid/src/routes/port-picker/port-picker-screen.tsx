import { createSignal, createResource, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ChangesFor, SavedFlow } from "@neuve/shared/models";
import type { DevServerHint } from "@neuve/shared/prompts";
import { useNavigation, Screen } from "../../context/navigation";
import { useProject } from "../../context/project";
import { detectListeningPorts, type Protocol } from "../../utils/detect-listening-ports";
import { detectNearbyProjects } from "../../utils/detect-projects";
import { Input } from "../../renderables/input";
import { Logo } from "../../renderables/logo";
import { COLORS, PORT_PICKER_VISIBLE_COUNT } from "../../constants";

interface PortPickerScreenProps {
  readonly changesFor: ChangesFor;
  readonly instruction: string;
  readonly savedFlow?: SavedFlow;
  readonly cookieBrowserKeys?: readonly string[];
}

interface PortEntry {
  readonly key: string;
  readonly port: number;
  readonly processName: string;
  readonly cwd: string;
  readonly protocol: Protocol;
}

const portEntryToUrl = (entry: PortEntry): string => `${entry.protocol}://localhost:${entry.port}`;

const deduplicateByPort = (entries: PortEntry[]): PortEntry[] => {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.port)) return false;
    seen.add(entry.port);
    return true;
  });
};

const normalizeCustomUrl = (value: string, entries: PortEntry[]): string => {
  const trimmed = value.trim();
  const portNumber = Number(trimmed);
  if (Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535) {
    const matchingEntry = entries.find((entry) => entry.port === portNumber);
    const protocol = matchingEntry?.protocol ?? "http";
    return `${protocol}://localhost:${portNumber}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

const POINTER = "\u25B8";
const CHECKBOX_ON = "\u2611";
const CHECKBOX_OFF = "\u2610";
const TICK = "\u2714";
const WARNING = "\u26A0";
const ARROW_RIGHT = "\u2192";
const ELLIPSIS = "\u2026";
const POINTER_SMALL = "\u203A";

export const PortPickerScreen = (props: PortPickerScreenProps) => {
  const navigation = useNavigation();
  const project = useProject();

  const [listeningPorts] = createResource(detectListeningPorts);
  const [detectedProjects] = createResource(() => detectNearbyProjects());

  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const initialSelectedPorts = (): Set<number> => {
    const lastUrl = project.lastBaseUrl();
    if (!lastUrl) return new Set();
    const urlMatch = lastUrl.match(/:(\d+)/);
    if (urlMatch) return new Set([Number(urlMatch[1])]);
    return new Set();
  };
  const [selectedPorts, setSelectedPorts] = createSignal<Set<number>>(initialSelectedPorts());
  const [customUrls, setCustomUrls] = createSignal<Set<string>>(new Set());
  const [isEnteringCustomUrl, setIsEnteringCustomUrl] = createSignal(false);
  const [customUrlValue, setCustomUrlValue] = createSignal("");

  const runningEntries = (): PortEntry[] =>
    (listeningPorts() ?? []).map((listening) => ({
      key: `running-${listening.port}`,
      port: listening.port,
      processName: listening.processName,
      cwd: listening.cwd,
      protocol: listening.protocol,
    }));

  const detectedEntries = (): PortEntry[] => {
    const running = runningEntries();
    const runningCwds = new Set(running.map((entry) => entry.cwd));
    const runningPortSet = new Set(running.map((entry) => entry.port));
    return deduplicateByPort(
      (detectedProjects() ?? [])
        .filter(
          (detected) =>
            !runningCwds.has(detected.path) && !runningPortSet.has(detected.defaultPort),
        )
        .map((detected) => ({
          key: `detected-${detected.path}`,
          port: detected.defaultPort,
          processName: detected.framework,
          cwd: detected.path,
          protocol: "http" as Protocol,
        })),
    );
  };

  const entries = (): PortEntry[] => [...runningEntries(), ...detectedEntries()];
  const hasRunningPorts = () => runningEntries().length > 0;

  const customUrlIndex = () => entries().length;
  const skipIndex = () => entries().length + 1;
  const itemCount = () => entries().length + 2;

  const scrollOffset = () => {
    const portListVisibleCount = PORT_PICKER_VISIBLE_COUNT - 2;
    const highlighted = highlightedIndex();
    if (highlighted < portListVisibleCount) return 0;
    return Math.min(highlighted - portListVisibleCount + 1, Math.max(0, entries().length - portListVisibleCount));
  };

  const buildDevServerHints = (selectedEntries: readonly PortEntry[]): DevServerHint[] =>
    selectedEntries
      .filter((entry) => entry.key.startsWith("detected-"))
      .flatMap((entry) => {
        const detected = (detectedProjects() ?? []).find((project) => project.path === entry.cwd);
        if (!detected?.devCommand) return [];
        return [
          {
            url: portEntryToUrl(entry),
            projectPath: detected.path,
            devCommand: detected.devCommand,
          },
        ];
      });

  const navigateToTesting = (baseUrls: readonly string[], selectedEntries: readonly PortEntry[]) => {
    const allUrls = [...baseUrls, ...customUrls()];
    const lastUrl = allUrls.length > 0 ? allUrls[0] : undefined;
    project.setLastBaseUrl(lastUrl);

    const devServerHints = buildDevServerHints(selectedEntries);

    navigation.navigateTo(
      Screen.Testing({
        changesFor: props.changesFor,
        instruction: props.instruction,
        savedFlow: props.savedFlow,
        cookieBrowserKeys: props.cookieBrowserKeys,
        baseUrls: allUrls.length > 0 ? allUrls : undefined,
        devServerHints: devServerHints.length > 0 ? devServerHints : undefined,
      }),
    );
  };

  const togglePort = (port: number) => {
    setSelectedPorts((previous) => {
      const next = new Set(previous);
      if (next.has(port)) {
        next.delete(port);
      } else {
        next.add(port);
      }
      return next;
    });
  };

  const confirmSelection = () => {
    if (highlightedIndex() === skipIndex()) {
      navigateToTesting([], []);
      return;
    }

    if (selectedPorts().size > 0 || customUrls().size > 0) {
      const selected = entries()
        .filter((entry) => selectedPorts().has(entry.port))
        .sort((left, right) => left.port - right.port);
      navigateToTesting(selected.map(portEntryToUrl), selected);
      return;
    }

    if (highlightedIndex() === customUrlIndex()) {
      setIsEnteringCustomUrl(true);
      return;
    }

    const entry = entries()[highlightedIndex()];
    if (entry) {
      navigateToTesting([portEntryToUrl(entry)], [entry]);
    }
  };

  const handleCustomUrlSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setIsEnteringCustomUrl(false);
      return;
    }
    const url = normalizeCustomUrl(trimmed, entries());
    setCustomUrls((previous) => new Set([...previous, url]));
    setCustomUrlValue("");
    setIsEnteringCustomUrl(false);
  };

  useKeyboard((event) => {
    if (isEnteringCustomUrl()) {
      if (event.name === "escape") {
        setIsEnteringCustomUrl(false);
        setCustomUrlValue("");
        event.preventDefault();
      }
      return;
    }

    if (event.name === "down" || event.name === "j") {
      setHighlightedIndex((previous) => Math.min(itemCount() - 1, previous + 1));
      return;
    }

    if (event.name === "up" || event.name === "k") {
      setHighlightedIndex((previous) => Math.max(0, previous - 1));
      return;
    }

    if (event.name === " ") {
      if (highlightedIndex() === customUrlIndex()) {
        setIsEnteringCustomUrl(true);
        return;
      }
      const entry = entries()[highlightedIndex()];
      if (entry) {
        togglePort(entry.port);
      }
      return;
    }

    if (event.name === "return") {
      confirmSelection();
      return;
    }
  });

  const portListVisibleCount = () => PORT_PICKER_VISIBLE_COUNT - 2;
  const visibleItems = () => entries().slice(scrollOffset(), scrollOffset() + portListVisibleCount());
  const customUrlVisible = () => scrollOffset() + portListVisibleCount() >= entries().length;
  const skipVisible = () => customUrlVisible();

  const highlightedEntry = () => entries()[highlightedIndex()];
  const isCustomUrlHighlighted = () => highlightedIndex() === customUrlIndex();
  const isSkipHighlighted = () => highlightedIndex() === skipIndex();

  const allSelectedUrls = () => [
    ...entries()
      .filter((entry) => selectedPorts().has(entry.port))
      .sort((left, right) => left.port - right.port)
      .map(portEntryToUrl),
    ...customUrls(),
  ];

  const isLoading = () => listeningPorts.loading || detectedProjects.loading;

  return (
    <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      <box>
        <Logo />
        <text>
          {" "}
          <span style={{ fg: COLORS.DIM }}>{POINTER_SMALL}</span>
          {" "}
          <span style={{ fg: COLORS.TEXT }}>{props.instruction}</span>
        </text>
      </box>

      <box marginTop={1} flexDirection="column">
        <text style={{ fg: COLORS.DIM }}>Pick the dev server the agent should open in the browser.</text>
        <Show when={!hasRunningPorts() && detectedEntries().length > 0}>
          <text style={{ fg: COLORS.YELLOW }}>
            {WARNING} No running servers found. Showing detected projects:
          </text>
        </Show>
      </box>

      <Show when={isLoading()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.DIM }}>Detecting ports...</text>
        </box>
      </Show>

      <Show when={!isLoading()}>
        <box marginTop={1}>
          <Show when={allSelectedUrls().length > 0}>
            <text style={{ fg: COLORS.GREEN }}>
              {TICK} {allSelectedUrls().join(", ")}
            </text>
          </Show>
          <Show when={allSelectedUrls().length === 0 && !isSkipHighlighted() && !isCustomUrlHighlighted() && highlightedEntry()}>
            {(entry) => (
              <text style={{ fg: COLORS.DIM }}>
                {ARROW_RIGHT} {portEntryToUrl(entry())}
              </text>
            )}
          </Show>
          <Show when={allSelectedUrls().length === 0 && isSkipHighlighted()}>
            <text style={{ fg: COLORS.YELLOW }}>
              {WARNING} No base URL. The agent won{"'"}t know where your dev server is.
            </text>
          </Show>
        </box>

        <box flexDirection="column" marginTop={1}>
          <For each={visibleItems()}>
            {(entry, index) => {
              const actualIndex = () => index() + scrollOffset();
              const isHighlighted = () => actualIndex() === highlightedIndex();
              const isSelected = () => selectedPorts().has(entry.port);

              return (
                <box>
                  <text style={{ fg: isHighlighted() ? COLORS.PRIMARY : COLORS.DIM }}>
                    {isHighlighted() ? `${POINTER} ` : "  "}
                  </text>
                  <text style={{ fg: isSelected() ? COLORS.PRIMARY : COLORS.DIM }}>
                    {isSelected() ? CHECKBOX_ON : CHECKBOX_OFF}{" "}
                  </text>
                  <text>
                    <span style={{ fg: isHighlighted() ? COLORS.PRIMARY : COLORS.TEXT, bold: isHighlighted() }}>
                      :{entry.port}
                    </span>
                  </text>
                  {entry.processName && <text style={{ fg: COLORS.DIM }}> {entry.processName}</text>}
                  {entry.cwd && <text style={{ fg: COLORS.DIM }}> {entry.cwd}</text>}
                </box>
              );
            }}
          </For>

          <Show when={customUrlVisible()}>
            <box>
              <text style={{ fg: isCustomUrlHighlighted() ? COLORS.PRIMARY : COLORS.DIM }}>
                {isCustomUrlHighlighted() ? `${POINTER} ` : "  "}
              </text>
              <Show when={isEnteringCustomUrl()}>
                <box>
                  <text style={{ fg: COLORS.PRIMARY }}>URL: </text>
                  <Input
                    focus
                    value={customUrlValue()}
                    placeholder="https://localhost:4000 or staging.example.com"
                    onChange={setCustomUrlValue}
                    onSubmit={handleCustomUrlSubmit}
                  />
                </box>
              </Show>
              <Show when={!isEnteringCustomUrl()}>
                <text>
                  <span style={{ fg: isCustomUrlHighlighted() ? COLORS.PRIMARY : COLORS.TEXT, bold: isCustomUrlHighlighted() }}>
                    Enter a custom URL{ELLIPSIS}
                  </span>
                </text>
              </Show>
            </box>

            <For each={[...customUrls()]}>
              {(url) => (
                <box>
                  <text> </text>
                  <text style={{ fg: COLORS.PRIMARY }}>{CHECKBOX_ON} </text>
                  <text style={{ fg: COLORS.TEXT }}>{url}</text>
                </box>
              )}
            </For>
          </Show>

          <Show when={skipVisible()}>
            <box>
              <text style={{ fg: isSkipHighlighted() ? COLORS.PRIMARY : COLORS.DIM }}>
                {isSkipHighlighted() ? `${POINTER} ` : "  "}
              </text>
              <text>
                <span style={{ fg: isSkipHighlighted() ? COLORS.PRIMARY : COLORS.DIM, bold: isSkipHighlighted() }}>
                  Skip {ARROW_RIGHT} no base URL
                </span>
              </text>
            </box>
          </Show>

          <Show when={entries().length === 0 && !skipVisible()}>
            <text style={{ fg: COLORS.DIM }}>No matching ports</text>
          </Show>
        </box>
      </Show>
    </box>
  );
};
