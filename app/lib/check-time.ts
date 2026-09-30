import type { Platform } from "./status";

export function checkTime(platform: Platform, index: number): string | undefined {
  // Older data only records the latest timestamp; never invent earlier times.
  const value = platform.checkTimes?.[index] ?? (index === 0 ? platform.checkedAt : undefined);
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function relativeCheckTime(timestamp: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (seconds < 1) return "just now";
  const [value, unit] = seconds < 60 ? [seconds, "second"]
    : seconds < 3600 ? [Math.floor(seconds / 60), "minute"]
    : seconds < 86400 ? [Math.floor(seconds / 3600), "hour"]
    : [Math.floor(seconds / 86400), "day"];
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}
