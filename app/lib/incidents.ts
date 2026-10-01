import { instanceStateHistory, type CheckStatus, type Platform } from "./status.ts";

export type Incident = {
  platformId: string;
  platformName: string;
  instance: string;
  currentStatus: CheckStatus;
  startedAt: string | null;
  recoveredAt: string | null;
  recovered: boolean;
};

// Pair failures with the next confirmed success. Unknown checks do not prove recovery.
export function recentIncidents(platforms: readonly Platform[]): Incident[] {
  const incidents: Incident[] = [];
  for (const platform of platforms) {
    for (const instance of platform.instances) {
      const history = instanceStateHistory(platform, instance);
      const current = history[0].status;
      let open: Incident | undefined;
      for (const state of [...history].reverse()) {
        if (state.status === "warning" && !open) {
          open = {
            platformId: platform.id, platformName: platform.name, instance,
            currentStatus: current === "warning" ? "critical" : current,
            startedAt: state.timestamp, recoveredAt: null, recovered: false,
          };
          incidents.push(open);
        } else if (state.status === "healthy" && open) {
          open.recovered = true;
          open.recoveredAt = state.timestamp;
          open = undefined;
        }
      }
    }
  }
  const eventTime = (incident: Incident) => {
    const timestamp = incident.recovered ? incident.recoveredAt : incident.startedAt;
    return timestamp && Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : -Infinity;
  };
  return incidents.sort((a, b) => eventTime(b) - eventTime(a) ||
    a.platformName.localeCompare(b.platformName) || a.instance.localeCompare(b.instance)).slice(0, 10);
}

export function incidentDuration(incident: Incident, now: number): string {
  const start = incident.startedAt ? Date.parse(incident.startedAt) : NaN;
  const end = incident.recovered ? Date.parse(incident.recoveredAt ?? "") : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Duration unavailable";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes % 60}m`;
}
