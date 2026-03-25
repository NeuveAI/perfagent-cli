import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BACKGROUND_COLOR,
  GREEN_COLOR,
  MUTED_COLOR,
  OVERLAY_GRADIENT_HEIGHT_PX,
  RED_COLOR,
  TEXT_COLOR,
} from "../constants";
import { fontFamily } from "../utils/font";
import { getBottomOverlayGradient } from "../utils/get-bottom-overlay-gradient";

interface ScannedFile {
  path: string;
  added: number;
  removed: number;
  untested?: boolean;
}

const UNTESTED_BG = "rgba(252, 39, 47, 0.12)";
const UNTESTED_BORDER_LEFT = "3px solid #FC272F";

const SCANNED_FILES: ScannedFile[] = [
  { path: "src/components/Button.tsx", added: 12, removed: 3 },
  { path: "src/components/UserCard.tsx", added: 45, removed: 18, untested: true },
  { path: "src/components/Dashboard.tsx", added: 28, removed: 41, untested: true },
  { path: "src/components/Modal.tsx", added: 7, removed: 0 },
  { path: "src/components/Sidebar.tsx", added: 0, removed: 15 },
  { path: "src/components/Header.tsx", added: 33, removed: 9, untested: true },
  { path: "src/components/Footer.tsx", added: 4, removed: 2 },
  { path: "src/components/NavBar.tsx", added: 19, removed: 22 },
  { path: "src/components/Avatar.tsx", added: 8, removed: 0 },
  { path: "src/components/Tooltip.tsx", added: 0, removed: 6 },
  { path: "src/components/Dropdown.tsx", added: 51, removed: 14, untested: true },
  { path: "src/components/Table.tsx", added: 23, removed: 31 },
  { path: "src/hooks/useAuth.ts", added: 67, removed: 12, untested: true },
  { path: "src/hooks/useDebounce.ts", added: 3, removed: 1 },
  { path: "src/hooks/useFetch.ts", added: 42, removed: 27, untested: true },
  { path: "src/hooks/useLocalStorage.ts", added: 11, removed: 0 },
  { path: "src/hooks/useMediaQuery.ts", added: 0, removed: 8 },
  { path: "src/hooks/useClickOutside.ts", added: 5, removed: 3 },
  { path: "src/hooks/useForm.ts", added: 38, removed: 19, untested: true },
  { path: "src/hooks/useThrottle.ts", added: 2, removed: 0 },
  { path: "src/pages/Home.tsx", added: 54, removed: 33, untested: true },
  { path: "src/pages/Settings.tsx", added: 16, removed: 7 },
  { path: "src/pages/Profile.tsx", added: 29, removed: 45, untested: true },
  { path: "src/pages/Login.tsx", added: 6, removed: 2 },
  { path: "src/pages/Register.tsx", added: 21, removed: 11 },
  { path: "src/pages/NotFound.tsx", added: 0, removed: 0 },
  { path: "src/pages/Dashboard.tsx", added: 73, removed: 28, untested: true },
  { path: "src/pages/Checkout.tsx", added: 14, removed: 36 },
  { path: "src/actions/deleteUser.ts", added: 9, removed: 4, untested: true },
  { path: "src/actions/updateProfile.ts", added: 17, removed: 0 },
  { path: "src/actions/createPost.ts", added: 31, removed: 8, untested: true },
  { path: "src/actions/uploadFile.ts", added: 5, removed: 2 },
  { path: "src/actions/sendEmail.ts", added: 22, removed: 15, untested: true },
  { path: "src/utils/format.ts", added: 3, removed: 1 },
  { path: "src/utils/validate.ts", added: 0, removed: 12 },
  { path: "src/utils/debounce.ts", added: 1, removed: 0 },
  { path: "src/utils/cn.ts", added: 0, removed: 0 },
  { path: "src/utils/date.ts", added: 8, removed: 5 },
  { path: "src/utils/slug.ts", added: 4, removed: 0 },
  { path: "src/context/ThemeProvider.tsx", added: 36, removed: 21, untested: true },
  { path: "src/context/AuthProvider.tsx", added: 58, removed: 9, untested: true },
  { path: "src/context/CartProvider.tsx", added: 15, removed: 7 },
  { path: "src/context/NotificationProvider.tsx", added: 27, removed: 13 },
  { path: "src/lib/api.ts", added: 44, removed: 19, untested: true },
  { path: "src/lib/db.ts", added: 6, removed: 0 },
  { path: "src/lib/cache.ts", added: 13, removed: 8 },
  { path: "src/lib/redis.ts", added: 0, removed: 5 },
  { path: "src/lib/stripe.ts", added: 9, removed: 3 },
  { path: "src/lib/email.ts", added: 18, removed: 0, untested: true },
  { path: "src/middleware/auth.ts", added: 41, removed: 16, untested: true },
  { path: "src/middleware/rateLimit.ts", added: 7, removed: 2 },
  { path: "src/middleware/cors.ts", added: 0, removed: 11 },
  { path: "src/middleware/logging.ts", added: 10, removed: 4 },
  { path: "src/types/user.ts", added: 14, removed: 0 },
  { path: "src/types/post.ts", added: 3, removed: 1 },
  { path: "src/types/api.ts", added: 22, removed: 9, untested: true },
  { path: "src/config/env.ts", added: 5, removed: 0 },
];

const FILE_FONT_SIZE_PX = 48;
const LINE_HEIGHT_MULTIPLIER = 1.6;
const LINE_HEIGHT_PX = FILE_FONT_SIZE_PX * LINE_HEIGHT_MULTIPLIER;
const FRAMES_PER_FILE = 2;
const FILE_INITIAL_DELAY_FRAMES = 3;
const FADE_IN_FRAMES = 6;
const VIEWPORT_HEIGHT_PX = 1080;
const CONTENT_PADDING_PX = 40;
const USABLE_HEIGHT_PX = VIEWPORT_HEIGHT_PX - CONTENT_PADDING_PX * 2;
const VISIBLE_ROW_COUNT = Math.floor(USABLE_HEIGHT_PX / LINE_HEIGHT_PX);
const TOTAL_LIST_HEIGHT_PX = SCANNED_FILES.length * LINE_HEIGHT_PX;
const MAX_SCROLL_PX = Math.max(0, TOTAL_LIST_HEIGHT_PX - USABLE_HEIGHT_PX);
const SCROLL_START_FRAME = FILE_INITIAL_DELAY_FRAMES + VISIBLE_ROW_COUNT * FRAMES_PER_FILE;
const SCROLL_END_FRAME = FILE_INITIAL_DELAY_FRAMES + SCANNED_FILES.length * FRAMES_PER_FILE;

const BAR_COLOR = "#FC272F";
const BAR_TRACK_COLOR = "#333333";
const BAR_TOTAL_SEGMENTS = 10;
const TARGET_FILLED_SEGMENTS = 2;
const FILLED_CHAR = "\u2588";
const EMPTY_CHAR = "\u2591";
const TARGET_PERCENT = 14;

const OVERLAY_APPEAR_FRAME = 40;
const OVERLAY_FADE_FRAMES = 12;
const FILL_START_FRAME = 48;
const FILL_DURATION_FRAMES = 20;
const SUBTITLE_HEIGHT_PX = 420;
const SUBTITLE_FONT_SIZE_PX = 88;

export const CoverageBar = () => {
  const frame = useCurrentFrame();

  const scrollY = interpolate(frame, [SCROLL_START_FRAME, SCROLL_END_FRAME], [0, MAX_SCROLL_PX], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  const subtitleOpacity = interpolate(
    frame,
    [OVERLAY_APPEAR_FRAME, OVERLAY_APPEAR_FRAME + OVERLAY_FADE_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const fillProgress = interpolate(
    frame,
    [FILL_START_FRAME, FILL_START_FRAME + FILL_DURATION_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const filledSegments = Math.round(fillProgress * TARGET_FILLED_SEGMENTS);
  const displayPercent = Math.round(fillProgress * TARGET_PERCENT);

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          padding: `${CONTENT_PADDING_PX}px 60px`,
        }}
      >
        <div style={{ transform: `translateY(-${scrollY}px)` }}>
          {SCANNED_FILES.map((file, index) => {
            const fileStartFrame = FILE_INITIAL_DELAY_FRAMES + index * FRAMES_PER_FILE;
            const localFrame = frame - fileStartFrame;
            const fileOpacity = interpolate(localFrame, [0, FADE_IN_FRAMES], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });

            const hasChanges = file.added > 0 || file.removed > 0;

            return (
              <div
                key={file.path}
                style={{
                  opacity: fileOpacity,
                  fontFamily,
                  fontSize: FILE_FONT_SIZE_PX,
                  lineHeight: LINE_HEIGHT_MULTIPLIER,
                  color: TEXT_COLOR,
                  whiteSpace: "nowrap",
                  display: "flex",
                  justifyContent: "space-between",
                  backgroundColor: file.untested ? UNTESTED_BG : "transparent",
                  borderLeft: file.untested ? UNTESTED_BORDER_LEFT : "3px solid transparent",
                  paddingLeft: 12,
                  paddingRight: 12,
                }}
              >
                <span>
                  {file.untested && <span style={{ color: RED_COLOR, fontWeight: 700 }}>! </span>}
                  <span style={{ color: MUTED_COLOR }}>{String(index + 1).padStart(2, " ")} </span>
                  <span>{file.path}</span>
                </span>
                {hasChanges && (
                  <span>
                    {file.added > 0 && <span style={{ color: GREEN_COLOR }}>+{file.added}</span>}
                    {file.added > 0 && file.removed > 0 && (
                      <span style={{ color: MUTED_COLOR }}> </span>
                    )}
                    {file.removed > 0 && <span style={{ color: RED_COLOR }}>-{file.removed}</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: `rgba(10, 10, 10, ${subtitleOpacity * 0.7})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: subtitleOpacity,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            fontFamily,
            fontSize: SUBTITLE_FONT_SIZE_PX,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <span style={{ color: BAR_COLOR }}>⚠</span>
            <span style={{ color: "#ffffff", fontWeight: 700 }}>Untested changes</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span style={{ color: BAR_COLOR }}>{FILLED_CHAR.repeat(filledSegments)}</span>
            <span style={{ color: BAR_TRACK_COLOR }}>
              {EMPTY_CHAR.repeat(BAR_TOTAL_SEGMENTS - filledSegments)}
            </span>
            <span style={{ color: BAR_COLOR, fontWeight: 700, marginLeft: 8 }}>
              {displayPercent}%
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
