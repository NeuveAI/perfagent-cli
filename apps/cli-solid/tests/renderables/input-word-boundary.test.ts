import { describe, test, expect } from "bun:test";

// Test the word boundary logic used by Input.
// These are copies of the private functions from input.tsx
// to enable isolated unit testing of the cursor navigation logic.

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

describe("findPreviousWordBoundary", () => {
  test("jumps from end of word to start of word", () => {
    const text = "hello world";
    expect(findPreviousWordBoundary(text, 11)).toBe(6);
  });

  test("jumps over spaces to previous word start", () => {
    const text = "foo bar baz";
    // From the 'b' in 'baz' (index 8)
    expect(findPreviousWordBoundary(text, 8)).toBe(4);
  });

  test("returns 0 at the beginning of text", () => {
    const text = "hello";
    expect(findPreviousWordBoundary(text, 0)).toBe(0);
  });

  test("returns 0 when in first word", () => {
    const text = "hello world";
    expect(findPreviousWordBoundary(text, 3)).toBe(0);
  });

  test("handles multiple spaces between words", () => {
    const text = "hello   world";
    expect(findPreviousWordBoundary(text, 13)).toBe(8);
  });

  test("handles special characters between words", () => {
    const text = "hello-world";
    // '-' is not a word char, so jumping backward from 'w' should land at '-' boundary
    expect(findPreviousWordBoundary(text, 11)).toBe(6);
  });
});

describe("findNextWordBoundary", () => {
  test("jumps from start of word to next word", () => {
    const text = "hello world";
    expect(findNextWordBoundary(text, 0)).toBe(6);
  });

  test("jumps over spaces to next word start", () => {
    const text = "foo bar baz";
    expect(findNextWordBoundary(text, 0)).toBe(4);
  });

  test("returns text length when at end", () => {
    const text = "hello";
    expect(findNextWordBoundary(text, 5)).toBe(5);
  });

  test("returns text length when in last word", () => {
    const text = "hello world";
    // From 'w' in 'world'
    expect(findNextWordBoundary(text, 6)).toBe(11);
  });

  test("handles multiple spaces", () => {
    const text = "hello   world";
    expect(findNextWordBoundary(text, 0)).toBe(8);
  });
});

describe("findCursorLineAndColumn", () => {
  test("single line: offset maps to column", () => {
    const result = findCursorLineAndColumn("hello", 3);
    expect(result.lineIndex).toBe(0);
    expect(result.column).toBe(3);
  });

  test("multiline: first line", () => {
    const result = findCursorLineAndColumn("hello\nworld", 3);
    expect(result.lineIndex).toBe(0);
    expect(result.column).toBe(3);
  });

  test("multiline: second line start", () => {
    const result = findCursorLineAndColumn("hello\nworld", 6);
    expect(result.lineIndex).toBe(1);
    expect(result.column).toBe(0);
  });

  test("multiline: second line middle", () => {
    const result = findCursorLineAndColumn("hello\nworld", 8);
    expect(result.lineIndex).toBe(1);
    expect(result.column).toBe(2);
  });

  test("multiline: end of last line", () => {
    const result = findCursorLineAndColumn("hello\nworld", 11);
    expect(result.lineIndex).toBe(1);
    expect(result.column).toBe(5);
  });

  test("three lines: third line", () => {
    const result = findCursorLineAndColumn("aa\nbb\ncc", 7);
    expect(result.lineIndex).toBe(2);
    expect(result.column).toBe(1);
  });

  test("empty string", () => {
    const result = findCursorLineAndColumn("", 0);
    expect(result.lineIndex).toBe(0);
    expect(result.column).toBe(0);
  });
});

describe("resolveOffsetFromLineColumn", () => {
  test("first line, first column", () => {
    const lines = ["hello", "world"];
    expect(resolveOffsetFromLineColumn(lines, 0, 0)).toBe(0);
  });

  test("first line, middle column", () => {
    const lines = ["hello", "world"];
    expect(resolveOffsetFromLineColumn(lines, 0, 3)).toBe(3);
  });

  test("second line, first column", () => {
    const lines = ["hello", "world"];
    expect(resolveOffsetFromLineColumn(lines, 1, 0)).toBe(6);
  });

  test("second line, middle column", () => {
    const lines = ["hello", "world"];
    expect(resolveOffsetFromLineColumn(lines, 1, 2)).toBe(8);
  });

  test("clamps column to line length", () => {
    const lines = ["hi", "world"];
    // Column 10 on "hi" (length 2) should clamp to offset 2
    expect(resolveOffsetFromLineColumn(lines, 0, 10)).toBe(2);
  });

  test("three lines, third line", () => {
    const lines = ["aa", "bb", "cc"];
    expect(resolveOffsetFromLineColumn(lines, 2, 1)).toBe(7);
  });
});
