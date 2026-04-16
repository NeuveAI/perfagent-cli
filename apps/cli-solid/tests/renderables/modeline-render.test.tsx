import { describe, test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { CommandProvider, useCommandRegistry } from "../../src/context/command";
import { Modeline } from "../../src/renderables/modeline";
import type { CommandDef } from "../../src/context/command-registry";

const renderModeline = (commands: readonly CommandDef[]) =>
  testRender(
    () => {
      const InnerWithCommands = () => {
        const registry = useCommandRegistry();
        registry.register(() => commands);
        return <Modeline />;
      };
      return (
        <CommandProvider inputFocused={() => false}>
          <InnerWithCommands />
        </CommandProvider>
      );
    },
    { width: 80, height: 5 },
  );

const makeCommand = (overrides: Partial<CommandDef> & { title: string; value: string }): CommandDef => ({
  category: "Test",
  enabled: true,
  onSelect: () => {},
  ...overrides,
});

describe("Modeline rendering", () => {
  test("renders visible commands as /slash-commands", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderModeline([
      makeCommand({ title: "cookies", value: "main.cookies", keybind: "ctrl+k" }),
      makeCommand({ title: "agent", value: "main.agent", keybind: "ctrl+a" }),
    ]);

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("/cookies");
    expect(frame).toContain("/agent");
  });

  test("does not render hidden commands", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderModeline([
      makeCommand({ title: "visible", value: "test.visible", keybind: "ctrl+v" }),
      makeCommand({ title: "hidden", value: "test.hidden", keybind: "ctrl+h", hidden: true }),
    ]);

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("visible");
    expect(frame).not.toContain("hidden");
  });

  test("does not render disabled commands", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderModeline([
      makeCommand({ title: "enabled", value: "test.enabled", keybind: "ctrl+e" }),
      makeCommand({ title: "disabled", value: "test.disabled", keybind: "ctrl+d", enabled: false }),
    ]);

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("enabled");
    expect(frame).not.toContain("disabled");
  });

  test("renders divider line", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderModeline([
      makeCommand({ title: "test", value: "test.test", keybind: "ctrl+t" }),
    ]);

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("\u2500");
  });

  test("renders commands without keybinds as /slash-commands", async () => {
    const { renderer, captureCharFrame, renderOnce } = await renderModeline([
      makeCommand({ title: "no keybind", value: "test.no-keybind" }),
    ]);

    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();

    expect(frame).toContain("/no-keybind");
  });
});
