import {
  RELATIVE_TIME_MS_PER_DAY,
  RELATIVE_TIME_MS_PER_HOUR,
  RELATIVE_TIME_MS_PER_MINUTE,
  RELATIVE_TIME_MS_PER_WEEK,
} from "../constants";

export const formatRelativeTime = (date: Date, now: Date = new Date()): string => {
  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  if (elapsedMs < RELATIVE_TIME_MS_PER_MINUTE) return "just now";
  if (elapsedMs < RELATIVE_TIME_MS_PER_HOUR) {
    const minutes = Math.floor(elapsedMs / RELATIVE_TIME_MS_PER_MINUTE);
    return `${minutes}m ago`;
  }
  if (elapsedMs < RELATIVE_TIME_MS_PER_DAY) {
    const hours = Math.floor(elapsedMs / RELATIVE_TIME_MS_PER_HOUR);
    return `${hours}h ago`;
  }
  if (elapsedMs < RELATIVE_TIME_MS_PER_WEEK) {
    const days = Math.floor(elapsedMs / RELATIVE_TIME_MS_PER_DAY);
    return `${days}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
