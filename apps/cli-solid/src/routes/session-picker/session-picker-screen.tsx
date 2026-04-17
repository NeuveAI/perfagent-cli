import { createSignal, onMount, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { listSessions, type SessionRecord } from "../../data/session-history";
import { useNavigation, Screen, screenForTestingOrPortPicker } from "../../context/navigation";
import { useProject } from "../../context/project";
import { useAgent } from "../../context/agent";
import { ChangesFor } from "@neuve/shared/models";
import { containsUrl } from "../../utils/detect-url";
import { Logo } from "../../renderables/logo";
import { COLORS } from "../../constants";

const TICK = "\u2714";
const CROSS = "\u2718";
const CIRCLE = "\u25CB";
const REPEAT = "\u21BB";
const POINTER = "\u25B8";

const MAX_VISIBLE = 10;
const INSTRUCTION_MAX_LENGTH = 60;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLIS_PER_SECOND = 1000;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;

const formatRelativeTime = (iso: string): string => {
  const elapsed = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(elapsed / MILLIS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return `${days}d ago`;
};

interface StatusAppearance {
  readonly glyph: string;
  readonly color: string;
}

const statusAppearance = (status: SessionRecord["status"]): StatusAppearance => {
  if (status === "completed") return { glyph: TICK, color: COLORS.GREEN };
  if (status === "failed") return { glyph: CROSS, color: COLORS.RED };
  if (status === "cancelled") return { glyph: REPEAT, color: COLORS.YELLOW };
  return { glyph: CIRCLE, color: COLORS.DIM };
};

export const SessionPickerScreen = () => {
  const navigation = useNavigation();
  const project = useProject();
  const agent = useAgent();

  const [sessions, setSessions] = createSignal<readonly SessionRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  onMount(() => {
    try {
      const list = listSessions();
      setSessions(list.slice(0, MAX_VISIBLE));
    } catch {
      setSessions([]);
    }
  });

  const resumeSession = (session: SessionRecord) => {
    const state = project.gitState();
    const mainBranch = state?.mainBranch ?? "main";
    const changesFor = ChangesFor.makeUnsafe({ _tag: "Changes", mainBranch });

    agent.rememberInstruction(session.instruction);

    const cookieKeys = project.cookieBrowserKeys();
    const cliUrls = project.cliBaseUrls();
    if (cliUrls) project.clearCliBaseUrls();

    if (cookieKeys.length > 0 || containsUrl(session.instruction) || cliUrls) {
      navigation.navigateTo(
        screenForTestingOrPortPicker({
          changesFor,
          instruction: session.instruction,
          cookieBrowserKeys: cookieKeys,
          baseUrls: cliUrls ? [...cliUrls] : undefined,
        }),
      );
      return;
    }

    navigation.navigateTo(
      Screen.CookieSyncConfirm({ changesFor, instruction: session.instruction }),
    );
  };

  useKeyboard((event) => {
    const list = sessions();
    if (list.length === 0) {
      if (event.name === "escape" || event.name === "return") {
        navigation.setScreen(Screen.Main());
      }
      return;
    }

    if (event.name === "up" || event.name === "k") {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.name === "down" || event.name === "j") {
      setSelectedIndex((index) => Math.min(list.length - 1, index + 1));
      return;
    }
    if (event.name === "return") {
      const session = list[selectedIndex()];
      if (session) resumeSession(session);
      return;
    }
    if (event.name === "escape") {
      navigation.setScreen(Screen.Main());
    }
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <box marginBottom={1} flexShrink={0}>
        <Logo />
        <text style={{ fg: COLORS.DIM }}>
          {"  Recent sessions \u2014 enter to resume, esc to go back"}
        </text>
      </box>

      <Show when={sessions().length === 0}>
        <text style={{ fg: COLORS.DIM }}>
          {"No sessions yet. Run a performance analysis first."}
        </text>
      </Show>

      <Show when={sessions().length > 0}>
        <box flexDirection="column">
          <For each={sessions()}>
            {(session, index) => {
              const isSelected = () => index() === selectedIndex();
              const appearance = () => statusAppearance(session.status);
              return (
                <text>
                  <span style={{ fg: isSelected() ? COLORS.PRIMARY : COLORS.DIM }}>
                    {isSelected() ? `${POINTER} ` : "  "}
                  </span>
                  <span style={{ fg: appearance().color }}>{appearance().glyph}</span>
                  <span>{" "}</span>
                  <span style={{ fg: COLORS.TEXT }}>
                    {truncate(session.instruction, INSTRUCTION_MAX_LENGTH)}
                  </span>
                  <span style={{ fg: COLORS.DIM }}>
                    {`  ${formatRelativeTime(session.createdAt)}`}
                  </span>
                </text>
              );
            }}
          </For>
        </box>
      </Show>
    </box>
  );
};
