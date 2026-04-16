import { render } from "@opentui/solid";
import App from "./app";

const TARGET_FPS = 60;

await render(App, {
  targetFps: TARGET_FPS,
  screenMode: "alternate-screen",
  exitOnCtrlC: true,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
  },
  useMouse: false,
});
