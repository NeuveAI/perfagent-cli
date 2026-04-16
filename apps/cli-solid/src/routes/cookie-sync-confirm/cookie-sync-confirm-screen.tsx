import { createSignal, createResource, createEffect, For, Show } from "solid-js";
import { Effect, Option } from "effect";
import { useKeyboard } from "@opentui/solid";
import { Browsers, layerLive, browserKeyOf, browserDisplayName } from "@neuve/cookies";
import type { BrowserKey } from "@neuve/cookies";
import type { ChangesFor, SavedFlow } from "@neuve/shared/models";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { useNavigation, Screen, screenForTestingOrPortPicker } from "../../context/navigation";
import { useProject } from "../../context/project";
import { Logo } from "../../renderables/logo";
import { COLORS } from "../../constants";

interface DetectedBrowser {
  readonly key: BrowserKey;
  readonly displayName: string;
  readonly isDefault: boolean;
}

const fetchInstalledBrowsers = (): Promise<DetectedBrowser[]> =>
  Effect.gen(function* () {
    const browsers = yield* Browsers;
    const allBrowsers = yield* browsers.list.pipe(
      Effect.catchTag("ListBrowsersError", () => Effect.succeed([])),
    );
    const maybeDefault = yield* browsers.defaultBrowser().pipe(
      Effect.map(Option.map(browserKeyOf)),
      Effect.map(Option.getOrUndefined),
      Effect.catchTag("ListBrowsersError", () => Effect.succeed(undefined)),
    );

    const seen = new Set<string>();
    const result: DetectedBrowser[] = [];
    for (const browser of allBrowsers) {
      const key = browserKeyOf(browser);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        displayName: browserDisplayName(browser),
        isDefault: key === maybeDefault,
      });
    }
    return result;
  }).pipe(
    Effect.provide(layerLive),
    Effect.provide(NodeServices.layer),
    Effect.tapCause((cause) => Effect.logWarning("Browser detection failed", { cause })),
    Effect.catchCause(() => Effect.succeed([] as DetectedBrowser[])),
    Effect.runPromise,
  );

interface CookieSyncConfirmScreenProps {
  readonly changesFor?: ChangesFor;
  readonly instruction?: string;
  readonly savedFlow?: SavedFlow;
}

const POINTER = "\u25B8";
const CHECKBOX_ON = "\u2611";
const CHECKBOX_OFF = "\u2610";
const TICK = "\u2714";
const WARNING = "\u26A0";
const POINTER_SMALL = "\u203A";

export const CookieSyncConfirmScreen = (props: CookieSyncConfirmScreenProps) => {
  const navigation = useNavigation();
  const project = useProject();

  const [browsers] = createResource(fetchInstalledBrowsers);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [selectedKeys, setSelectedKeys] = createSignal<Set<string>>(new Set());
  const [defaultsInitialized, setDefaultsInitialized] = createSignal(false);

  const items = (): DetectedBrowser[] => browsers() ?? [];
  const isLoading = () => browsers.loading;
  const selectedCount = () => selectedKeys().size;

  createEffect(() => {
    const browserList = browsers();
    if (defaultsInitialized() || !browserList || browserList.length === 0) return;
    setDefaultsInitialized(true);
    const defaultBrowser = browserList.find((browser) => browser.isDefault);
    if (defaultBrowser) {
      setSelectedKeys(new Set([defaultBrowser.key]));
    }
  });

  const toggleKey = (key: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const confirm = () => {
    const keys = [...selectedKeys()];
    project.setCookieBrowserKeys(keys);

    if (props.changesFor && props.instruction) {
      navigation.navigateTo(
        screenForTestingOrPortPicker({
          changesFor: props.changesFor,
          instruction: props.instruction,
          savedFlow: props.savedFlow,
          cookieBrowserKeys: keys,
        }),
      );
    } else {
      navigation.setScreen(Screen.Main());
    }
  };

  useKeyboard((event) => {
    if (isLoading()) return;

    const itemCount = items().length;

    if (event.name === "down" || event.name === "j") {
      setHighlightedIndex((previous) => Math.min(itemCount - 1, previous + 1));
      return;
    }

    if (event.name === "up" || event.name === "k") {
      setHighlightedIndex((previous) => Math.max(0, previous - 1));
      return;
    }

    if (event.name === " " && itemCount > 0) {
      const item = items()[highlightedIndex()];
      if (item) toggleKey(item.key);
      return;
    }

    if (event.name === "a" && !event.ctrl) {
      const allKeys: string[] = items().map((browser) => browser.key);
      setSelectedKeys(new Set(allKeys));
      return;
    }

    if (event.name === "n" && !event.ctrl) {
      setSelectedKeys(new Set<string>());
      return;
    }

    if (event.name === "return") {
      confirm();
      return;
    }
  });

  return (
    <box flexDirection="column" width="100%" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      <box>
        <Logo />
        <text>
          {" "}
          <span style={{ fg: COLORS.DIM }}>{POINTER_SMALL}</span>
          {" "}
          <span style={{ fg: COLORS.TEXT }}>{props.instruction ?? "Select browsers for cookie sync"}</span>
        </text>
      </box>

      <box marginTop={1}>
        <Show when={selectedCount() > 0}>
          <text style={{ fg: COLORS.GREEN }}>
            {TICK} Your signed-in session will be synced from {selectedCount()} browser{selectedCount() === 1 ? "" : "s"}
          </text>
        </Show>
        <Show when={selectedCount() === 0}>
          <text style={{ fg: COLORS.YELLOW }}>
            {WARNING} No browsers selected — tests run without authentication
          </text>
        </Show>
      </box>

      <Show when={isLoading()}>
        <box marginTop={1}>
          <text style={{ fg: COLORS.DIM }}>Detecting installed browsers...</text>
        </box>
      </Show>

      <Show when={!isLoading()}>
        <box flexDirection="column" marginTop={1}>
          <For each={items()}>
            {(browser, index) => {
              const isHighlighted = () => index() === highlightedIndex();
              const isSelected = () => selectedKeys().has(browser.key);

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
                      {browser.displayName}
                    </span>
                  </text>
                  {browser.isDefault && <text style={{ fg: COLORS.DIM }}> (default)</text>}
                </box>
              );
            }}
          </For>
        </box>
      </Show>
    </box>
  );
};
