export type CheckStatus = "healthy" | "critical" | "unknown";
export type DashboardStatus = CheckStatus | "warning";
export type InstanceState = { status: "healthy" | "warning" | "unknown"; timestamp: string | null };

export type Platform = {
  id: string;
  name: string;
  instances: string[];
  healthUrls?: Record<string, string>;
  checkedAt?: string;
  checkTimes?: (string | null)[];
  createdAt?: string;
  stateHistory?: Record<string, InstanceState[]>;
  // Newest first. Each index represents the same check window for every instance.
  checks?: Record<string, (boolean | null)[]>;
};

export const storageKey = "nighthawk-platforms";
export const checkHistoryIndices = [0, 1, 2];

// State transitions are independent per instance; raw checks remain aligned
// across instances for the dashboard's total-outage calculation.
export function instanceStateHistory(platform: Platform, instance: string): InstanceState[] {
  const saved = platform.stateHistory?.[instance];
  if (saved?.length) return saved;
  const history: InstanceState[] = [{ status: "unknown", timestamp: platform.createdAt ?? null }];
  const checks = platform.checks?.[instance] ?? [];
  for (let index = checks.length - 1; index >= 0; index--) {
    const status = checks[index] === true ? "healthy" : checks[index] === false ? "warning" : "unknown";
    if (history[0].status !== status) {
      history.unshift({ status, timestamp: platform.checkTimes?.[index] ?? (index === 0 ? platform.checkedAt ?? null : null) });
    }
  }
  return history;
}

export function instanceStatus(platform: Platform, instance: string, index = 0): CheckStatus {
  const result = platform.checks?.[instance]?.[index];
  return result === true ? "healthy" : result === false ? "critical" : "unknown";
}

export function platformStatus(platform: Platform, index = 0): CheckStatus {
  const statuses = platform.instances.map((instance) => instanceStatus(platform, instance, index));
  if (statuses.includes("healthy")) return "healthy";
  if (statuses.length && statuses.every((status) => status === "critical")) return "critical";
  return "unknown";
}

export function dashboardStatus(platform: Platform): DashboardStatus {
  const current = platformStatus(platform);
  if (current !== "healthy") return current;
  return checkHistoryIndices.some((index) => index > 0 && platformStatus(platform, index) === "critical")
    ? "warning"
    : "healthy";
}

export const statusLabels: Record<DashboardStatus, string> = {
  healthy: "Successful health check",
  critical: "Offline",
  warning: "All instances were offline during the displayed window; now recovered",
  unknown: "No conclusive health check",
};

// Sample health checks keep the dashboard and detail views consistent.
export const defaultPlatforms: Platform[] = Array.from({ length: 15 }, (_, index) => {
  const instances = [`https://a.platform-${index + 1}.example.com`, `https://b.platform-${index + 1}.example.com`];
  const history = index === 0 ? [false, false, true] : index < 3 ? [true, false, true] : [true, true, true];
  return {
    id: `platform-${index + 1}`,
    name: `Platform ${index + 1}`,
    instances,
    checks: Object.fromEntries(instances.map((instance) => [instance, [...history]])),
  };
});
