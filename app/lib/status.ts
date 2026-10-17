import { uptimePercent } from "./uptime.ts";

export type CheckStatus = "healthy" | "critical" | "unknown";
export type DashboardStatus = CheckStatus | "warning";
export type PlatformState = { status: CheckStatus; timestamp: string | null };
export type InstanceState = { status: "healthy" | "warning" | "unknown"; timestamp: string | null };
export type UptimeSample = { good: number; samples: number; firstSampleAt: string; lastSampleAt: string };

export type Platform = {
  id: string;
  name: string;
  instances: string[];
  healthUrls?: Record<string, string>;
  checkedAt?: string;
  checkTimes?: (string | null)[];
  createdAt?: string;
  platformStateHistory?: PlatformState[];
  stateHistory?: Record<string, InstanceState[]>;
  // Newest first. Each index represents the same check window for every instance.
  checks?: Record<string, (boolean | null)[]>;
  // Confirmed health for each retained cycle, separate from raw probe results.
  checkStatuses?: Record<string, CheckStatus[]>;
  uptime?: Record<string, UptimeSample>;
  platformUptime?: UptimeSample;
};

export const storageKey = "nighthawk-platforms";
export const checkHistoryIndices = [0, 1, 2];
export const failureThreshold = 2;

// State transitions are independent per instance; confirmed checks remain aligned
// across instances for the dashboard's total-outage calculation.
export function instanceStateHistory(platform: Platform, instance: string): InstanceState[] {
  const saved = platform.stateHistory?.[instance];
  if (saved?.length) return saved;
  const history: InstanceState[] = [{ status: "unknown", timestamp: platform.createdAt ?? null }];
  const checks = platform.checks?.[instance] ?? [];
  for (let index = checks.length - 1; index >= 0; index--) {
    const health = instanceStatus(platform, instance, index);
    const status = health === "critical" ? "warning" : health;
    if (history[0].status !== status) {
      history.unshift({ status, timestamp: platform.checkTimes?.[index] ?? (index === 0 ? platform.checkedAt ?? null : null) });
    }
  }
  return history;
}

export function instanceStatus(platform: Platform, instance: string, index = 0): CheckStatus {
  const saved = platform.checkStatuses?.[instance]?.[index];
  if (saved) return saved;
  const checks = platform.checks?.[instance] ?? [];
  if (index < 0 || index >= checks.length) return "unknown";
  let status: CheckStatus = "unknown";
  let failures = 0;
  for (let i = checks.length - 1; i >= index; i--) {
    if (checks[i] === false) {
      if (++failures >= failureThreshold) status = "critical";
    } else {
      failures = 0;
      status = checks[i] === true ? "healthy" : "unknown";
    }
  }
  return status;
}

export function platformStatus(platform: Platform, index = 0): CheckStatus {
  const statuses = platform.instances.map((instance) => instanceStatus(platform, instance, index));
  if (statuses.includes("healthy")) return "healthy";
  if (statuses.length && statuses.every((status) => status === "critical")) return "critical";
  return "unknown";
}

// Keep the initial unknown state and only add a box when aggregate health changes.
// Older records can recover only the checks still retained on disk.
export function platformStateHistory(platform: Platform): PlatformState[] {
  if (platform.platformStateHistory?.length) return platform.platformStateHistory;
  const history: PlatformState[] = [{ status: "unknown", timestamp: platform.createdAt ?? null }];
  const count = Math.max(0, ...platform.instances.map((instance) => platform.checks?.[instance]?.length ?? 0));
  for (let index = count - 1; index >= 0; index--) {
    const status = platformStatus(platform, index);
    if (history[0].status !== status) {
      history.unshift({ status, timestamp: platform.checkTimes?.[index] ?? (index === 0 ? platform.checkedAt ?? null : null) });
    }
  }
  return history;
}

export function daysSinceOutage(platform: Platform, now: number): number {
  if (platformStatus(platform) === "critical") return 0;

  const history = platformStateHistory(platform);
  const outageIndex = history.findIndex((state) => state.status === "critical");
  // Unknown results cannot close an outage. Count from the first confirmed
  // recovery after the most recent total outage, even outside the raw checks.
  const since = outageIndex === -1
    ? platform.createdAt ?? history[history.length - 1]?.timestamp
    : history.slice(0, outageIndex).reverse().find((state) => state.status === "healthy")?.timestamp;
  const timestamp = Date.parse(since ?? "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

export function dashboardStatus(platform: Platform): DashboardStatus {
  const current = platformStatus(platform);
  if (current !== "healthy") return current;
  return checkHistoryIndices.some((index) => index > 0 && platformStatus(platform, index) === "critical")
    ? "warning"
    : "healthy";
}

export type DashboardSort = "alphabetical" | "status" | "sla-ascending" | "sla-descending";

// Known outages first; inconclusive checks stay ahead of confirmed health.
const dashboardStatusOrder: Record<DashboardStatus, number> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  healthy: 3,
};

export function sortDashboardPlatforms(platforms: readonly Platform[], sort: DashboardSort): Platform[] {
  return [...platforms].sort((a, b) => {
    if (sort === "sla-ascending" || sort === "sla-descending") {
      const aPercent = uptimePercent(a.platformUptime);
      const bPercent = uptimePercent(b.platformUptime);
      // Missing data stays last in either direction; it is not 0% uptime.
      if (aPercent === null && bPercent !== null) return 1;
      if (aPercent !== null && bPercent === null) return -1;
      if (aPercent !== null && bPercent !== null && aPercent !== bPercent) {
        return sort === "sla-ascending" ? aPercent - bPercent : bPercent - aPercent;
      }
    }
    const statusDifference = sort === "status"
      ? dashboardStatusOrder[dashboardStatus(a)] - dashboardStatusOrder[dashboardStatus(b)]
      : 0;
    return statusDifference || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

export const statusLabels: Record<DashboardStatus, string> = {
  healthy: "Healthy (fewer than two consecutive failed checks)",
  critical: "Offline",
  warning: "All instances were offline during the displayed window; now recovered",
  unknown: "No conclusive health check",
};

// Sample health checks keep the dashboard and detail views consistent.
export const defaultPlatforms: Platform[] = Array.from({ length: 15 }, (_, index) => {
  const instances = [`https://a.platform-${index + 1}.example.com`, `https://b.platform-${index + 1}.example.com`];
  const history = index === 0 ? [false, false, false] : index < 3 ? [true, false, false, false] : [true, true, true];
  return {
    id: `platform-${index + 1}`,
    name: `Platform ${index + 1}`,
    instances,
    checks: Object.fromEntries(instances.map((instance) => [instance, [...history]])),
  };
});
