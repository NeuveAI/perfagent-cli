import { KeyEvent, type ParsedKey } from "@opentui/core";

const BASE_KEY: ParsedKey = {
  name: "",
  ctrl: false,
  meta: false,
  shift: false,
  option: false,
  sequence: "",
  number: false,
  raw: "",
  eventType: "press",
  source: "raw",
};

export const makeKeyEvent = (overrides: Partial<ParsedKey>): KeyEvent =>
  new KeyEvent({ ...BASE_KEY, ...overrides });

export const ctrlKey = (letter: string): KeyEvent =>
  makeKeyEvent({ name: letter.toLowerCase(), ctrl: true });

export const arrowKey = (direction: "up" | "down" | "left" | "right"): KeyEvent =>
  makeKeyEvent({ name: direction });

export const charKey = (character: string): KeyEvent =>
  makeKeyEvent({ name: character });

export const escKey = (): KeyEvent =>
  makeKeyEvent({ name: "escape" });

export const enterKey = (): KeyEvent =>
  makeKeyEvent({ name: "return" });

export const backspaceKey = (): KeyEvent =>
  makeKeyEvent({ name: "backspace" });

export const deleteKey = (): KeyEvent =>
  makeKeyEvent({ name: "delete" });

export const shiftEnterKey = (): KeyEvent =>
  makeKeyEvent({ name: "return", shift: true });

export const metaKey = (letter: string): KeyEvent =>
  makeKeyEvent({ name: letter.toLowerCase(), meta: true });
