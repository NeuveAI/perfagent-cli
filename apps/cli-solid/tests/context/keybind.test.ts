import { describe, test, expect } from "bun:test";
import { match, print } from "../../src/context/keybind";
import { makeKeyEvent } from "../helpers/make-key-event";

describe("keybind match", () => {
  describe("ctrl + letter combos", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");

    for (const letter of letters) {
      test(`ctrl+${letter} matches ctrl+${letter} event`, () => {
        const event = makeKeyEvent({ name: letter, ctrl: true });
        expect(match(`ctrl+${letter}`, event)).toBe(true);
      });

      test(`ctrl+${letter} does NOT match bare ${letter}`, () => {
        const event = makeKeyEvent({ name: letter });
        expect(match(`ctrl+${letter}`, event)).toBe(false);
      });

      test(`ctrl+${letter} does NOT match meta+${letter}`, () => {
        const event = makeKeyEvent({ name: letter, meta: true });
        expect(match(`ctrl+${letter}`, event)).toBe(false);
      });
    }
  });

  describe("arrow keys", () => {
    test("up matches up event", () => {
      expect(match("up", makeKeyEvent({ name: "up" }))).toBe(true);
    });

    test("down matches down event", () => {
      expect(match("down", makeKeyEvent({ name: "down" }))).toBe(true);
    });

    test("left matches left event", () => {
      expect(match("left", makeKeyEvent({ name: "left" }))).toBe(true);
    });

    test("right matches right event", () => {
      expect(match("right", makeKeyEvent({ name: "right" }))).toBe(true);
    });

    test("ctrl+left matches ctrl left arrow", () => {
      expect(match("ctrl+left", makeKeyEvent({ name: "left", ctrl: true }))).toBe(true);
    });

    test("ctrl+right matches ctrl right arrow", () => {
      expect(match("ctrl+right", makeKeyEvent({ name: "right", ctrl: true }))).toBe(true);
    });

    test("up does NOT match down", () => {
      expect(match("up", makeKeyEvent({ name: "down" }))).toBe(false);
    });
  });

  describe("special keys", () => {
    test("enter matches return event", () => {
      expect(match("enter", makeKeyEvent({ name: "return" }))).toBe(true);
    });

    test("esc matches escape event", () => {
      expect(match("esc", makeKeyEvent({ name: "escape" }))).toBe(true);
    });

    test("space matches space event", () => {
      expect(match("space", makeKeyEvent({ name: " " }))).toBe(true);
    });

    test("backspace matches backspace event", () => {
      expect(match("backspace", makeKeyEvent({ name: "backspace" }))).toBe(true);
    });

    test("delete matches delete event", () => {
      expect(match("delete", makeKeyEvent({ name: "delete" }))).toBe(true);
    });

    test("tab matches tab event", () => {
      expect(match("tab", makeKeyEvent({ name: "tab" }))).toBe(true);
    });

    test("pgup matches pageup event", () => {
      expect(match("pgup", makeKeyEvent({ name: "pageup" }))).toBe(true);
    });

    test("pgdn matches pagedown event", () => {
      expect(match("pgdn", makeKeyEvent({ name: "pagedown" }))).toBe(true);
    });
  });

  describe("modifier combos", () => {
    test("meta+b matches option+b (option alias)", () => {
      expect(match("meta+b", makeKeyEvent({ name: "b", option: true }))).toBe(true);
    });

    test("alt+b matches meta+b event (alt alias for meta)", () => {
      expect(match("alt+b", makeKeyEvent({ name: "b", meta: true }))).toBe(true);
    });

    test("shift+enter matches shift return", () => {
      expect(match("shift+enter", makeKeyEvent({ name: "return", shift: true }))).toBe(true);
    });

    test("shift+enter does NOT match plain return", () => {
      expect(match("shift+enter", makeKeyEvent({ name: "return" }))).toBe(false);
    });
  });

  describe("case insensitivity", () => {
    test("Ctrl+K matches ctrl+k event", () => {
      expect(match("Ctrl+K", makeKeyEvent({ name: "k", ctrl: true }))).toBe(true);
    });

    test("CTRL+L matches ctrl+l event", () => {
      expect(match("CTRL+L", makeKeyEvent({ name: "l", ctrl: true }))).toBe(true);
    });
  });

  describe("cross-key rejection", () => {
    test("ctrl+a does NOT match ctrl+b", () => {
      expect(match("ctrl+a", makeKeyEvent({ name: "b", ctrl: true }))).toBe(false);
    });

    test("enter does NOT match escape", () => {
      expect(match("enter", makeKeyEvent({ name: "escape" }))).toBe(false);
    });

    test("esc does NOT match return", () => {
      expect(match("esc", makeKeyEvent({ name: "return" }))).toBe(false);
    });
  });
});

describe("keybind print", () => {
  test("ctrl+f prints as ^F", () => {
    expect(print("ctrl+f")).toBe("^F");
  });

  test("ctrl+a prints as ^A", () => {
    expect(print("ctrl+a")).toBe("^A");
  });

  test("ctrl+l prints as ^L", () => {
    expect(print("ctrl+l")).toBe("^L");
  });

  test("enter prints as Enter", () => {
    expect(print("enter")).toBe("Enter");
  });

  test("esc prints as Esc", () => {
    expect(print("esc")).toBe("Esc");
  });

  test("space prints as Space", () => {
    expect(print("space")).toBe("Space");
  });

  test("up prints as arrow symbol", () => {
    expect(print("up")).toBe("\u2191");
  });

  test("down prints as arrow symbol", () => {
    expect(print("down")).toBe("\u2193");
  });

  test("left prints as arrow symbol", () => {
    expect(print("left")).toBe("\u2190");
  });

  test("right prints as arrow symbol", () => {
    expect(print("right")).toBe("\u2192");
  });

  test("tab prints as Tab", () => {
    expect(print("tab")).toBe("Tab");
  });

  test("backspace prints as Bksp", () => {
    expect(print("backspace")).toBe("Bksp");
  });

  test("delete prints as Del", () => {
    expect(print("delete")).toBe("Del");
  });

  test("pgup prints as PgUp", () => {
    expect(print("pgup")).toBe("PgUp");
  });

  test("pgdn prints as PgDn", () => {
    expect(print("pgdn")).toBe("PgDn");
  });

  test("meta+b prints as M-B", () => {
    expect(print("meta+b")).toBe("M-B");
  });

  test("shift+enter prints as S-Enter", () => {
    expect(print("shift+enter")).toBe("S-Enter");
  });

  test("ctrl+shift+k prints with both modifiers", () => {
    expect(print("ctrl+shift+k")).toBe("^S-K");
  });

  test("bare letter prints uppercase", () => {
    expect(print("j")).toBe("J");
  });

  test("bare letter k prints uppercase", () => {
    expect(print("k")).toBe("K");
  });
});
