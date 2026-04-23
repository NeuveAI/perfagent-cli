import { createEffect, on, onMount } from "solid-js";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
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

const MULTILINE_KEY_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "linefeed", action: "newline" },
] as const;

const SINGLE_LINE_KEY_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
] as const;

export const Input = (props: InputProps) => {
  let textareaRef: TextareaRenderable | undefined;
  let pendingHistoryDirection: "up" | "down" | undefined;
  const inputFocus = useInputFocus();
  const focus = () => props.focus ?? true;

  createEffect(() => {
    inputFocus.setFocused(focus());
  });

  onMount(() => {
    if (textareaRef && textareaRef.plainText.length > 0) {
      textareaRef.cursorOffset = textareaRef.plainText.length;
    }
  });

  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!textareaRef) return;
        if (textareaRef.plainText === value) return;
        textareaRef.setText(value);
        if (pendingHistoryDirection === "up") {
          textareaRef.cursorOffset = 0;
        } else {
          textareaRef.cursorOffset = value.length;
        }
        pendingHistoryDirection = undefined;
      },
    ),
  );

  const handleContentChange = () => {
    const value = textareaRef?.plainText ?? "";
    if (value !== props.value) {
      props.onChange(value);
    }
  };

  const handleSubmit = () => {
    const value = textareaRef?.plainText ?? "";
    props.onSubmit?.(value);
  };

  const handleKeyDown = (event: KeyEvent) => {
    if (!textareaRef) return;

    if (
      event.sequence === "@" &&
      !event.ctrl &&
      !event.meta &&
      !event.option &&
      textareaRef.plainText === "" &&
      props.onAtTrigger
    ) {
      event.preventDefault();
      props.onAtTrigger();
      return;
    }

    if (event.name === "up" && !event.shift && !event.meta && !event.ctrl && !event.super) {
      const cursor = textareaRef.visualCursor;
      if (cursor.offset === 0) {
        if (props.onUpArrowAtTop) {
          event.preventDefault();
          pendingHistoryDirection = "up";
          props.onUpArrowAtTop();
        }
        return;
      }
      if (cursor.visualRow === 0) {
        event.preventDefault();
        textareaRef.cursorOffset = 0;
        return;
      }
    }

    if (event.name === "down" && !event.shift && !event.meta && !event.ctrl && !event.super) {
      const cursor = textareaRef.visualCursor;
      const endOffset = textareaRef.plainText.length;
      if (cursor.offset >= endOffset) {
        if (props.onDownArrowAtBottom) {
          event.preventDefault();
          pendingHistoryDirection = "down";
          props.onDownArrowAtBottom();
        }
        return;
      }
      const lastVisualRow = textareaRef.virtualLineCount - 1;
      if (cursor.visualRow >= lastVisualRow) {
        event.preventDefault();
        textareaRef.cursorOffset = endOffset;
        return;
      }
    }
  };

  const keyBindings = () =>
    props.multiline ? [...MULTILINE_KEY_BINDINGS] : [...SINGLE_LINE_KEY_BINDINGS];

  return (
    <textarea
      ref={(ref) => {
        textareaRef = ref;
      }}
      focused={focus()}
      initialValue={props.value}
      placeholder={props.placeholder ?? null}
      placeholderColor={COLORS.DIM}
      textColor={COLORS.TEXT}
      focusedTextColor={COLORS.TEXT}
      backgroundColor="transparent"
      focusedBackgroundColor="transparent"
      keyBindings={keyBindings()}
      onContentChange={handleContentChange}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      flexGrow={1}
    />
  );
};
