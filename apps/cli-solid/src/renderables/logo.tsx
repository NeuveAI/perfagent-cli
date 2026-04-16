const CROSS = "\u2718";
const TICK = "\u2714";
const VERSION = "dev";

const COLORS = {
  RED: 0xff5555ff,
  GREEN: 0x50fa7bff,
  PRIMARY: 0x8be9fdff,
  DIM: 0x6272a4ff,
  BORDER: 0xbd93f9ff,
};

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
