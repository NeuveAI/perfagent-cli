const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

export const formatElapsedTime = (elapsedTimeMs: number): string => {
  const clamped = Math.max(0, elapsedTimeMs);
  const totalSeconds = Math.floor(clamped / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};
