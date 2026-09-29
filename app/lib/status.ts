export type CheckStatus = "healthy" | "critical" | "unknown";
export type DashboardStatus = CheckStatus | "warning";

export type Platform = {
  id: string;
  name: string;
  instances: string[];
  // Newest first. Each index represents the same check window for every instance.
  checks?: Record<string, (boolean | null)[]>;
};

export const storageKey = "nighthawk-platforms";
export const recentActivity = ["just now", "30 mins ago", "1 hour ago"];

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
  return recentActivity.some((_, index) => index > 0 && platformStatus(platform, index) === "critical")
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
