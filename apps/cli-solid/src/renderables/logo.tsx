import { COLORS } from "../constants";

const CROSS = "\u2718";
const TICK = "\u2714";
const VERSION = "dev";

export const Logo = () => {
  return (
    <box>
      <text>
        <span style={{ fg: COLORS.RED }}>{CROSS}</span>
        <span style={{ fg: COLORS.GREEN }}>{TICK}</span>
        <span style={{ fg: COLORS.PRIMARY, bold: true }}>{" Perf Agent"}</span>
        <span style={{ fg: COLORS.DIM }}>{` v${VERSION}`}</span>
      </text>
    </box>
  );
};
