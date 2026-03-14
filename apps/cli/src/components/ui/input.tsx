import React, { useState, useEffect } from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";

interface InputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly mask?: string;
  readonly showCursor?: boolean;
  readonly highlightPastedText?: boolean;
  readonly multiline?: boolean;
}

const isWordChar = (character: string): boolean => /\w/.test(character);

const findPreviousWordBoundary = (text: string, from: number): number => {
  let index = from - 1;
  while (index > 0 && !isWordChar(text[index]!)) index--;
  while (index > 0 && isWordChar(text[index - 1]!)) index--;
  return index;
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

const resolveOffsetFromLineColumn = (lines: string[], lineIndex: number, column: number): number => {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset += lines[index]!.length + 1;
  }
  return offset + Math.min(column, lines[lineIndex]!.length);
};

export const Input = ({
  value: originalValue,
  placeholder = "",
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  multiline = false,
  onChange,
  onSubmit,
}: InputProps) => {
  const [state, setState] = useState({
    cursorOffset: (originalValue || "").length,
    cursorWidth: 0,
  });

  const { cursorOffset, cursorWidth } = state;

  useEffect(() => {
    setState((previousState) => {
      if (!focus || !showCursor) return previousState;

      const newValue = originalValue || "";
      if (previousState.cursorOffset > newValue.length - 1) {
        return { cursorOffset: newValue.length, cursorWidth: 0 };
      }

      return previousState;
    });
  }, [originalValue, focus, showCursor]);

  const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
  const value = mask ? mask.repeat(originalValue.length) : originalValue;
  let renderedValue = value;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
        : chalk.inverse(" ");

    renderedValue = value.length > 0 ? "" : chalk.inverse(" ");

    let characterIndex = 0;
    for (const character of value) {
      const isAtCursor =
        characterIndex >= cursorOffset - cursorActualWidth && characterIndex <= cursorOffset;
      if (isAtCursor && character === "\n") {
        renderedValue += chalk.inverse(" ") + "\n";
      } else {
        renderedValue += isAtCursor ? chalk.inverse(character) : character;
      }
      characterIndex++;
    }

    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += chalk.inverse(" ");
    }
  }

  useInput(
    (input, key) => {
      if (
        (!multiline && (key.upArrow || key.downArrow)) ||
        (key.ctrl && input === "c") ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;
      let nextCursorWidth = 0;
      let handled = false;

      if (multiline && key.upArrow && showCursor) {
        const { lineIndex, column, lines } = findCursorLineAndColumn(originalValue, cursorOffset);
        if (lineIndex > 0) {
          nextCursorOffset = resolveOffsetFromLineColumn(lines, lineIndex - 1, column);
        }
        handled = true;
      } else if (multiline && key.downArrow && showCursor) {
        const { lineIndex, column, lines } = findCursorLineAndColumn(originalValue, cursorOffset);
        if (lineIndex < lines.length - 1) {
          nextCursorOffset = resolveOffsetFromLineColumn(lines, lineIndex + 1, column);
        }
        handled = true;
      } else if (key.ctrl && input === "u") {
        if (cursorOffset > 0) {
          nextValue = originalValue.slice(cursorOffset);
          nextCursorOffset = 0;
        }
        handled = true;
      } else if (key.ctrl && input === "w") {
        if (cursorOffset > 0) {
          const wordBoundary = findPreviousWordBoundary(originalValue, cursorOffset);
          nextValue = originalValue.slice(0, wordBoundary) + originalValue.slice(cursorOffset);
          nextCursorOffset = wordBoundary;
        }
        handled = true;
      } else if (key.meta && input === "b" && showCursor) {
        nextCursorOffset = findPreviousWordBoundary(originalValue, cursorOffset);
        handled = true;
      } else if (key.meta && input === "f" && showCursor) {
        nextCursorOffset = findNextWordBoundary(originalValue, cursorOffset);
        handled = true;
      } else if (key.meta && (key.backspace || key.delete)) {
        if (cursorOffset > 0) {
          const wordBoundary = findPreviousWordBoundary(originalValue, cursorOffset);
          nextValue = originalValue.slice(0, wordBoundary) + originalValue.slice(cursorOffset);
          nextCursorOffset = wordBoundary;
        }
        handled = true;
      } else if (key.meta) {
        return;
      }

      if (!handled) {
        if (key.return) {
          if (multiline && key.shift) {
            nextValue =
              originalValue.slice(0, cursorOffset) + "\n" + originalValue.slice(cursorOffset);
            nextCursorOffset++;
          } else {
            if (onSubmit) onSubmit(originalValue);
            return;
          }
        } else if (key.leftArrow) {
          if (showCursor) {
            nextCursorOffset--;
          }
        } else if (key.rightArrow) {
          if (showCursor) {
            nextCursorOffset++;
          }
        } else if (key.backspace || key.delete) {
          if (cursorOffset > 0) {
            nextValue =
              originalValue.slice(0, cursorOffset - 1) +
              originalValue.slice(cursorOffset, originalValue.length);
            nextCursorOffset--;
          }
        } else {
          nextValue =
            originalValue.slice(0, cursorOffset) +
            input +
            originalValue.slice(cursorOffset, originalValue.length);
          nextCursorOffset += input.length;
          if (input.length > 1) {
            nextCursorWidth = input.length;
          }
        }
      }

      if (nextCursorOffset < 0) {
        nextCursorOffset = 0;
      }

      if (nextCursorOffset > nextValue.length) {
        nextCursorOffset = nextValue.length;
      }

      setState({
        cursorOffset: nextCursorOffset,
        cursorWidth: nextCursorWidth,
      });

      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus },
  );

  return (
    <Text>
      {placeholder ? (value.length > 0 ? renderedValue : renderedPlaceholder) : renderedValue}
    </Text>
  );
};
