import type { KeyEvent } from "@opentui/core";

interface KeyDescriptor {
  readonly name: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

const parseKeyName = (keyName: string): KeyDescriptor => {
  const parts = keyName.toLowerCase().split("+");
  let ctrl = false;
  let meta = false;
  let shift = false;
  let name = "";

  for (const part of parts) {
    if (part === "ctrl") {
      ctrl = true;
    } else if (part === "meta" || part === "alt") {
      meta = true;
    } else if (part === "shift") {
      shift = true;
    } else {
      name = part;
    }
  }

  return { name, ctrl, meta, shift };
};

export const match = (keyName: string, event: KeyEvent): boolean => {
  const descriptor = parseKeyName(keyName);

  if (descriptor.ctrl !== event.ctrl) return false;
  if (descriptor.meta !== (event.meta || event.option)) return false;
  if (descriptor.shift !== event.shift) return false;

  const eventName = event.name.toLowerCase();

  if (descriptor.name === "enter" && eventName === "return") return true;
  if (descriptor.name === "esc" && eventName === "escape") return true;
  if (descriptor.name === "space" && eventName === " ") return true;
  if (descriptor.name === "up" && eventName === "up") return true;
  if (descriptor.name === "down" && eventName === "down") return true;
  if (descriptor.name === "left" && eventName === "left") return true;
  if (descriptor.name === "right" && eventName === "right") return true;
  if (descriptor.name === "backspace" && eventName === "backspace") return true;
  if (descriptor.name === "delete" && eventName === "delete") return true;
  if (descriptor.name === "tab" && eventName === "tab") return true;
  if (descriptor.name === "pgup" && eventName === "pageup") return true;
  if (descriptor.name === "pgdn" && eventName === "pagedown") return true;

  return descriptor.name === eventName;
};

const PRINT_MAP: Record<string, string> = {
  ctrl: "^",
  enter: "Enter",
  esc: "Esc",
  space: "Space",
  up: "\u2191",
  down: "\u2193",
  left: "\u2190",
  right: "\u2192",
  tab: "Tab",
  backspace: "Bksp",
  delete: "Del",
  pgup: "PgUp",
  pgdn: "PgDn",
};

export const print = (keyName: string): string => {
  const parts = keyName.toLowerCase().split("+");
  const modifiers: string[] = [];
  let mainKey = "";

  for (const part of parts) {
    if (part === "ctrl") {
      modifiers.push("^");
    } else if (part === "meta" || part === "alt") {
      modifiers.push("M-");
    } else if (part === "shift") {
      modifiers.push("S-");
    } else {
      mainKey = PRINT_MAP[part] ?? part.toUpperCase();
    }
  }

  return modifiers.join("") + mainKey;
};
