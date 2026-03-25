import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import {
  CHECK_ICON_COLOR,
  COMMAND,
  ERROR_ICON_COLOR,
  SPINNER_CHARS,
  SPINNER_SPEED_FRAMES,
  VIDEO_HEIGHT_PX,
  VIDEO_WIDTH_PX,
} from "../constants";
import { fontFamily } from "../utils/font";
import { BrowserCell, CELL_HEIGHT_PX, CELL_WIDTH_PX, type PageVariant } from "./browser-cell";

const FRAMES_PER_CASE = 75;
const FINALE_FRAMES = 120;
const CASE_COUNT = 3;
export const SPLIT_SCREEN_DURATION_FRAMES = FRAMES_PER_CASE * CASE_COUNT + FINALE_FRAMES;

interface TestCase {
  category: string;
  label: string;
  variant: PageVariant;
}

const TEST_CASES: TestCase[] = [
  { category: "Perf", label: "FCP exceeds 2.5s", variant: "signup" },
  { category: "Security", label: "CSRF missing on /subscribe", variant: "analytics" },
  { category: "Debug", label: "TypeError — undefined", variant: "dashboard" },
];

const BROWSER_MARGIN_PX = 50;
const OVERLAY_HEIGHT_PX = 280;
const OVERLAY_ICON_SIZE_PX = 140;
const OVERLAY_FONT_SIZE_PX = 88;

const AVAIL_WIDTH_PX = VIDEO_WIDTH_PX - BROWSER_MARGIN_PX * 2;
const AVAIL_HEIGHT_PX = VIDEO_HEIGHT_PX - BROWSER_MARGIN_PX - OVERLAY_HEIGHT_PX / 2;
const FULL_BROWSER_SCALE = Math.min(
  AVAIL_WIDTH_PX / CELL_WIDTH_PX,
  AVAIL_HEIGHT_PX / CELL_HEIGHT_PX,
);
const FULL_BROWSER_LEFT = (VIDEO_WIDTH_PX - CELL_WIDTH_PX * FULL_BROWSER_SCALE) / 2;
const FULL_BROWSER_TOP =
  (VIDEO_HEIGHT_PX - OVERLAY_HEIGHT_PX / 2 - CELL_HEIGHT_PX * FULL_BROWSER_SCALE) / 2;

const FAIL_START_FRAMES = 18;
const FAIL_DURATION_FRAMES = 8;
const SHIMMER_CYCLE_FRAMES = 30;

const FINALE_START_FRAME = FRAMES_PER_CASE * CASE_COUNT;
const FINALE_OVERLAY_FADE_FRAMES = 12;
const FINALE_ROW_STAGGER_FRAMES = 6;
const FINALE_ROW_APPEAR_FRAMES = 8;
const FINALE_ROW_SPACING_PX = 130;
const FINALE_ICON_SIZE_PX = 100;
const FINALE_FONT_SIZE_PX = 88;
const FINALE_GROUP_HEIGHT_PX = (CASE_COUNT - 1) * FINALE_ROW_SPACING_PX;
const FINALE_TOP_START_PX = (VIDEO_HEIGHT_PX - FINALE_GROUP_HEIGHT_PX) / 2;
const FINALE_LEFT_PX = 80;
const FINALE_COMMAND_FONT_SIZE_PX = 48;
const FINALE_APPEAR_DELAY_FRAMES = 8;
const FINALE_RESOLVE_DELAY_FRAMES = 20;
const FINALE_RESOLVE_STAGGER_FRAMES = 6;
const FINALE_RESOLVE_DURATION_FRAMES = 6;
const FINALE_COVERAGE_DELAY_FRAMES = 10;
const FINALE_COVERAGE_FILL_FRAMES = 20;
const FINALE_COVERAGE_FONT_SIZE_PX = 64;
const FINALE_COVERAGE_BAR_FONT_SIZE_PX = 56;
const FINALE_FILLED_CHAR = "\u2588";
const FINALE_EMPTY_CHAR = "\u2591";
const FINALE_BAR_SEGMENTS = 10;

const AsciiSpinner = ({ size, frame }: { size: number; frame: number }) => {
  const charIndex = Math.floor(frame / SPINNER_SPEED_FRAMES) % SPINNER_CHARS.length;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.7,
        lineHeight: 1,
        color: "#888",
        fontFamily,
      }}
    >
      {SPINNER_CHARS[charIndex]}
    </div>
  );
};

const FailedIcon = ({
  size,
  opacity,
  scale = 1,
}: {
  size: number;
  opacity: number;
  scale?: number;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{
      opacity,
      position: "absolute",
      inset: 0,
      transform: `scale(${scale})`,
      transformOrigin: "center center",
    }}
  >
    <path
      d="M12 1.25C17.937 1.25 22.75 6.063 22.75 12C22.75 17.937 17.937 22.75 12 22.75C6.063 22.75 1.25 17.937 1.25 12C1.25 6.063 6.063 1.25 12 1.25ZM9.631 8.225C9.238 7.904 8.659 7.927 8.293 8.293C7.927 8.659 7.904 9.238 8.225 9.631L8.293 9.707L10.586 12L8.294 14.293C7.904 14.684 7.903 15.317 8.294 15.707C8.684 16.097 9.318 16.097 9.708 15.707L12 13.414L14.292 15.707L14.368 15.775C14.761 16.096 15.34 16.073 15.706 15.707C16.072 15.341 16.095 14.762 15.775 14.369L15.706 14.293L13.413 12L15.707 9.707L15.775 9.631C16.096 9.238 16.073 8.659 15.707 8.293C15.341 7.927 14.762 7.904 14.369 8.225L14.293 8.293L12 10.586L9.707 8.293L9.631 8.225Z"
      fill={ERROR_ICON_COLOR}
    />
  </svg>
);

const CheckIcon = ({
  size,
  opacity,
  scale = 1,
}: {
  size: number;
  opacity: number;
  scale?: number;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    style={{
      opacity,
      position: "absolute",
      inset: 0,
      transform: `scale(${scale})`,
      transformOrigin: "center center",
    }}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M1.25 12C1.25 17.937 6.063 22.75 12 22.75C17.937 22.75 22.75 17.937 22.75 12C22.75 6.063 17.937 1.25 12 1.25C6.063 1.25 1.25 6.063 1.25 12ZM16.676 8.263C17.083 8.636 17.11 9.269 16.737 9.676L11.237 15.676C11.053 15.877 10.794 15.994 10.522 16C10.249 16.006 9.986 15.9 9.793 15.707L7.293 13.207C6.902 12.817 6.902 12.183 7.293 11.793C7.683 11.402 8.317 11.402 8.707 11.793L10.469 13.554L15.263 8.324C15.636 7.917 16.269 7.89 16.676 8.263Z"
      fill={CHECK_ICON_COLOR}
    />
  </svg>
);

const ShimmerText = ({ text, frame }: { text: string; frame: number }) => {
  const progress = (frame % SHIMMER_CYCLE_FRAMES) / SHIMMER_CYCLE_FRAMES;
  const shimmerPosition = progress * 200 - 50;

  return (
    <span
      style={{
        backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.7) ${shimmerPosition}%, rgba(255,255,255,0.35) ${shimmerPosition + 30}%)`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      {text}
    </span>
  );
};

export const SplitScreen = () => {
  const frame = useCurrentFrame();
  const isFinale = frame >= FINALE_START_FRAME;
  const activeCaseIndex = isFinale
    ? CASE_COUNT - 1
    : Math.min(CASE_COUNT - 1, Math.floor(frame / FRAMES_PER_CASE));

  const activeCase = TEST_CASES[activeCaseIndex];
  const localFrame = frame - activeCaseIndex * FRAMES_PER_CASE;

  const hasFailed = isFinale || localFrame >= FAIL_START_FRAMES;

  const finaleOverlayOpacity = isFinale
    ? interpolate(
        frame,
        [FINALE_START_FRAME, FINALE_START_FRAME + FINALE_OVERLAY_FADE_FRAMES],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
      )
    : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {TEST_CASES.map((testCase, index) => (
        <Sequence
          key={testCase.label}
          from={index * FRAMES_PER_CASE}
          durationInFrames={
            index === CASE_COUNT - 1 ? FRAMES_PER_CASE + FINALE_FRAMES : FRAMES_PER_CASE
          }
        >
          <div
            style={{
              position: "absolute",
              left: FULL_BROWSER_LEFT,
              top: FULL_BROWSER_TOP,
              transform: `scale(${FULL_BROWSER_SCALE})`,
              transformOrigin: "top left",
            }}
          >
            <BrowserCell variant={testCase.variant} />
          </div>
        </Sequence>
      ))}

      {!isFinale && (
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: "100%",
            height: OVERLAY_HEIGHT_PX,
            background:
              "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 20%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.75) 70%, rgba(0,0,0,0.95) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: OVERLAY_HEIGHT_PX * 0.25,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              fontFamily,
              fontSize: OVERLAY_FONT_SIZE_PX,
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                width: OVERLAY_ICON_SIZE_PX,
                height: OVERLAY_ICON_SIZE_PX,
                position: "relative",
                flexShrink: 0,
              }}
            >
              {hasFailed ? (
                <FailedIcon size={OVERLAY_ICON_SIZE_PX} opacity={1} />
              ) : (
                <AsciiSpinner size={OVERLAY_ICON_SIZE_PX} frame={frame} />
              )}
            </div>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: VIDEO_WIDTH_PX - OVERLAY_ICON_SIZE_PX - 20 - 160,
              }}
            >
              {hasFailed ? (
                <span style={{ color: ERROR_ICON_COLOR }}>{activeCase.label}</span>
              ) : (
                <ShimmerText text={activeCase.label} frame={frame} />
              )}
            </span>
          </div>
        </div>
      )}

      {isFinale && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(0, 0, 0, ${finaleOverlayOpacity * 0.92})`,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: FINALE_ROW_SPACING_PX - FINALE_ICON_SIZE_PX,
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              style={{
                fontSize: FINALE_COMMAND_FONT_SIZE_PX,
                fontFamily,
                opacity: finaleOverlayOpacity,
                marginBottom: 8,
              }}
            >
              <span style={{ color: "#555" }}>$ </span>
              <span style={{ color: "#999" }}>{COMMAND}</span>
            </div>

            {(() => {
              const appearStart = FINALE_START_FRAME + FINALE_APPEAR_DELAY_FRAMES;
              const resolveBase =
                appearStart + FINALE_ROW_APPEAR_FRAMES + FINALE_RESOLVE_DELAY_FRAMES;
              const lastResolveEnd =
                resolveBase +
                (CASE_COUNT - 1) * FINALE_RESOLVE_STAGGER_FRAMES +
                FINALE_RESOLVE_DURATION_FRAMES;
              const coverageStart = lastResolveEnd + FINALE_COVERAGE_DELAY_FRAMES;
              const coverageProgress = interpolate(
                frame,
                [coverageStart, coverageStart + FINALE_COVERAGE_FILL_FRAMES],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.cubic),
                },
              );
              const coverageOpacity = interpolate(
                frame,
                [coverageStart - 5, coverageStart + 5],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.cubic),
                },
              );
              const filledSegments = Math.round(coverageProgress * FINALE_BAR_SEGMENTS);
              const displayPercent = Math.round(coverageProgress * 100);

              const rowOpacity = interpolate(
                frame,
                [appearStart, appearStart + FINALE_ROW_APPEAR_FRAMES],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.out(Easing.cubic),
                },
              );

              return (
                <>
                  {TEST_CASES.map((testCase, index) => {
                    const resolveStart = resolveBase + index * FINALE_RESOLVE_STAGGER_FRAMES;
                    const resolveProgress = interpolate(
                      frame,
                      [resolveStart, resolveStart + FINALE_RESOLVE_DURATION_FRAMES],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: Easing.out(Easing.cubic),
                      },
                    );
                    const resolveScale = interpolate(resolveProgress, [0, 1], [0.7, 1]);

                    return (
                      <div
                        key={testCase.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 20,
                          fontFamily,
                          fontSize: FINALE_FONT_SIZE_PX,
                          whiteSpace: "nowrap",
                          opacity: rowOpacity,
                        }}
                      >
                        <div
                          style={{
                            width: FINALE_ICON_SIZE_PX,
                            height: FINALE_ICON_SIZE_PX,
                            position: "relative",
                            flexShrink: 0,
                          }}
                        >
                          <FailedIcon size={FINALE_ICON_SIZE_PX} opacity={1 - resolveProgress} />
                          <CheckIcon
                            size={FINALE_ICON_SIZE_PX}
                            opacity={resolveProgress}
                            scale={resolveScale}
                          />
                        </div>
                        <span
                          style={{
                            color: resolveProgress >= 0.5 ? CHECK_ICON_COLOR : ERROR_ICON_COLOR,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: VIDEO_WIDTH_PX - FINALE_ICON_SIZE_PX - 20 - 160,
                          }}
                        >
                          {testCase.label}
                        </span>
                      </div>
                    );
                  })}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 24,
                      fontFamily,
                      whiteSpace: "nowrap",
                      opacity: coverageOpacity,
                      marginTop: 20,
                    }}
                  >
                    <span
                      style={{
                        fontSize: FINALE_COVERAGE_FONT_SIZE_PX,
                        fontWeight: 700,
                        color: CHECK_ICON_COLOR,
                        lineHeight: 1,
                      }}
                    >
                      {displayPercent}%
                    </span>
                    <span style={{ fontSize: FINALE_COVERAGE_BAR_FONT_SIZE_PX, lineHeight: 1 }}>
                      <span style={{ color: CHECK_ICON_COLOR }}>
                        {FINALE_FILLED_CHAR.repeat(filledSegments)}
                      </span>
                      <span style={{ color: "#333333" }}>
                        {FINALE_EMPTY_CHAR.repeat(FINALE_BAR_SEGMENTS - filledSegments)}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: FINALE_COVERAGE_FONT_SIZE_PX,
                        color: CHECK_ICON_COLOR,
                        lineHeight: 1,
                      }}
                    >
                      test coverage
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
