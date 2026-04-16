import { createSignal, createEffect, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useInputFocus } from "../context/input-focus";
import { COLORS } from "../constants";

interface InputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly multiline?: boolean;
  readonly onUpArrowAtTop?: () => void;
  readonly onDownArrowAtBottom?: () => void;
  readonly onAtTrigger?: () => void;
}

const isWordChar = (character: string): boolean => /\w/.test(character);

const findPreviousWordBoundary = (text: string, from: number): number => {
  let index = from - 1;
  while (index > 0 && !isWordChar(text[index]!)) index--;
  while (index > 0 && isWordChar(text[index - 1]!)) index--;
  return Math.max(0, index);
};

const findNextWordBoundary = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && isWordChar(text[index]!)) index++;
  while (index < text.length && !isWordChar(text[index]!)) index++;
  return index;
};

const findCursorLineAndColumn = (
  text: string,
  offset: number,
): { lineIndex: number; column: number; lines: string[] } => {
  const lines = text.split("\n");
  let position = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineLength = lines[lineIndex]!.length;
    if (offset <= position + lineLength) {
      return { lineIndex, column: offset - position, lines };
    }
    position += lineLength + 1;
  }
  const lastLine = lines.length - 1;
  return { lineIndex: lastLine, column: lines[lastLine]!.length, lines };
};

const resolveOffsetFromLineColumn = (
  lines: string[],
  lineIndex: number,
  column: number,
): number => {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset += lines[index]!.length + 1;
  }
  return offset + Math.min(column, lines[lineIndex]!.length);
};

export const Input = (props: InputProps) => {
  const [cursorOffset, setCursorOffset] = createSignal(props.value.length);
  const inputFocus = useInputFocus();
  const focus = () => props.focus ?? true;

  createEffect(() => {
    inputFocus.setFocused(focus());
  });

  useKeyboard((event) => {
    if (!focus()) return;

    const value = props.value;
    let nextOffset = cursorOffset();
    let nextValue = value;
    let handled = false;

    if (event.name === "return" && !event.shift) {
      props.onSubmit?.(value);
      return;
    }

    if (event.name === "return" && event.shift && props.multiline) {
      nextValue = value.slice(0, nextOffset) + "\n" + value.slice(nextOffset);
      nextOffset++;
      handled = true;
    }

    if (!handled && event.name === "up" && props.multiline) {
      const { lineIndex, column, lines } = findCursorLineAndColumn(value, nextOffset);
      if (lineIndex > 0) {
        nextOffset = resolveOffsetFromLineColumn(lines, lineIndex - 1, column);
      } else {
        props.onUpArrowAtTop?.();
        return;
      }
      handled = true;
    }

    if (!handled && event.name === "down" && props.multiline) {
      const { lineIndex, column, lines } = findCursorLineAndColumn(value, nextOffset);
      if (lineIndex < lines.length - 1) {
        nextOffset = resolveOffsetFromLineColumn(lines, lineIndex + 1, column);
      } else {
        props.onDownArrowAtBottom?.();
        return;
      }
      handled = true;
    }

    if (!handled && event.name === "left" && !event.ctrl && !event.meta) {
      nextOffset = Math.max(0, nextOffset - 1);
      handled = true;
    }

    if (!handled && event.name === "right" && !event.ctrl && !event.meta) {
      nextOffset = Math.min(value.length, nextOffset + 1);
      handled = true;
    }

    if (!handled && event.meta && event.name === "b") {
      nextOffset = findPreviousWordBoundary(value, nextOffset);
      handled = true;
    }

    if (!handled && event.meta && event.name === "f") {
      nextOffset = findNextWordBoundary(value, nextOffset);
      handled = true;
    }

    if (!handled && event.ctrl && event.name === "a") {
      nextOffset = 0;
      handled = true;
    }

    if (!handled && event.ctrl && event.name === "e") {
      nextOffset = value.length;
      handled = true;
    }

    if (!handled && event.name === "backspace") {
      if (nextOffset > 0) {
        nextValue = value.slice(0, nextOffset - 1) + value.slice(nextOffset);
        nextOffset--;
      }
      handled = true;
    }

    if (!handled && event.name === "delete") {
      if (nextOffset < value.length) {
        nextValue = value.slice(0, nextOffset) + value.slice(nextOffset + 1);
      }
      handled = true;
    }

    if (!handled && event.ctrl && event.name === "w") {
      if (nextOffset > 0) {
        const boundary = findPreviousWordBoundary(value, nextOffset);
        nextValue = value.slice(0, boundary) + value.slice(nextOffset);
        nextOffset = boundary;
      }
      handled = true;
    }

    if (!handled && !event.ctrl && !event.meta && event.name.length === 1) {
      const character = event.name;
      if (character === "@" && value === "" && props.onAtTrigger) {
        props.onAtTrigger();
        return;
      }
      nextValue = value.slice(0, nextOffset) + character + value.slice(nextOffset);
      nextOffset += character.length;
      handled = true;
    }

    if (!handled) return;

    nextOffset = Math.max(0, Math.min(nextValue.length, nextOffset));
    setCursorOffset(nextOffset);

    if (nextValue !== value) {
      props.onChange(nextValue);
    }
  });

  const displayValue = () => {
    const value = props.value;
    if (value.length === 0 && props.placeholder) {
      return props.placeholder;
    }
    return value;
  };

  const displayColor = () => {
    if (props.value.length === 0 && props.placeholder) {
      return COLORS.DIM;
    }
    return COLORS.TEXT;
  };

  return (
    <box flexGrow={1}>
      <text style={{ fg: displayColor() }}>{displayValue()}</text>
      <Show when={focus() && props.value.length === 0 && !props.placeholder}>
        <text style={{ fg: COLORS.DIM }}>{" "}</text>
      </Show>
    </box>
  );
};
