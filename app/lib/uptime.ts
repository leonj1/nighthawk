import type { UptimeSample } from "./status";

export const uptimeWindowDays = 30;
export const uptimeTargetPercent = 99.5;
export const minimumUptimeSamples = 60;
const day = 86_400_000;

export function uptimePercent(sample?: UptimeSample): number | null {
  if (!sample || sample.samples <= 0) return null;
  return Math.floor(sample.good * 10_000 / sample.samples) / 100;
}

export function uptimeCoverageDays(sample: UptimeSample, now: number): number {
  const first = Date.parse(sample.firstSampleAt);
  if (!Number.isFinite(first) || !Number.isFinite(now)) return uptimeWindowDays;
  return Math.max(1, Math.min(uptimeWindowDays, Math.ceil((now - first) / day)));
}

export function uptimeSummary(sample: UptimeSample | undefined, now: number) {
  const percent = uptimePercent(sample);
  if (percent === null || !sample) return { percent: null, label: "No uptime data", coverage: "", provisional: false, meetsTarget: null };
  const first = Date.parse(sample.firstSampleAt);
  return {
    percent,
    label: `${percent.toFixed(2)}%`,
    coverage: `over ${uptimeCoverageDays(sample, now)} of ${uptimeWindowDays} days`,
    provisional: sample.samples < minimumUptimeSamples || !Number.isFinite(first) || now - first < day,
    meetsTarget: percent >= uptimeTargetPercent,
  };
}
