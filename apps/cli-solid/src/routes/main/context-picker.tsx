import { createSignal, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { RuledBox } from "../../renderables/ruled-box";
import { Spinner } from "../../renderables/spinner";
import { COLORS } from "../../constants";

interface ContextOption {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
}

interface ContextPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (value: string) => void;
}

const PLACEHOLDER_OPTIONS: readonly ContextOption[] = [
  { label: "Working tree", description: "Current changes", value: "working-tree" },
  { label: "main", description: "Main branch", value: "branch:main" },
  { label: "develop", description: "Development branch", value: "branch:develop" },
];

export const ContextPicker = (props: ContextPickerProps) => {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [query, setQuery] = createSignal("");

  const filteredOptions = () => {
    const searchQuery = query().toLowerCase();
    if (!searchQuery) return PLACEHOLDER_OPTIONS;
    return PLACEHOLDER_OPTIONS.filter(
      (option) =>
        option.label.toLowerCase().includes(searchQuery) ||
        (option.description?.toLowerCase().includes(searchQuery) ?? false),
    );
  };

  useKeyboard((event) => {
    if (!props.open) return;

    if (event.name === "escape") {
      props.onClose();
      event.preventDefault();
      return;
    }

    if (event.name === "up") {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
      event.preventDefault();
      return;
    }

    if (event.name === "down") {
      setSelectedIndex((previous) => Math.min(filteredOptions().length - 1, previous + 1));
      event.preventDefault();
      return;
    }

    if (event.name === "return") {
      const selected = filteredOptions()[selectedIndex()];
      if (selected) {
        props.onSelect(selected.value);
      }
      event.preventDefault();
      return;
    }

    if (event.name === "backspace") {
      const currentQuery = query();
      if (currentQuery.length === 0) {
        props.onClose();
      } else {
        setQuery(currentQuery.slice(0, -1));
      }
      event.preventDefault();
      return;
    }

    if (!event.ctrl && !event.meta && event.name.length === 1) {
      setQuery((previous) => previous + event.name);
      setSelectedIndex(0);
      event.preventDefault();
    }
  });

  return (
    <Show when={props.open}>
      <RuledBox>
        <box marginBottom={0}>
          <text>
            <span style={{ fg: COLORS.DIM }}>@ </span>
            <span style={{ fg: COLORS.PRIMARY }}>{query()}</span>
            <Show when={!query()}>
              <span style={{ fg: COLORS.DIM }}>type to filter</span>
            </Show>
          </text>
        </box>
        <For each={filteredOptions()}>
          {(option, index) => {
            const isSelected = () => index() === selectedIndex();
            return (
              <box>
                <text>
                  <span style={{ fg: isSelected() ? COLORS.PRIMARY : COLORS.TEXT }}>
                    {isSelected() ? "\u25B6 " : "  "}
                    {option.label}
                  </span>
                  <Show when={option.description}>
                    <span style={{ fg: COLORS.DIM }}> ({option.description})</span>
                  </Show>
                </text>
              </box>
            );
          }}
        </For>
        <Show when={filteredOptions().length === 0}>
          <text style={{ fg: COLORS.DIM }}>No matching contexts</text>
        </Show>
      </RuledBox>
    </Show>
  );
};
