"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteInstance, deletePlatform, usePlatforms } from "../lib/use-platforms";
import { relativeCheckTime } from "../lib/check-time";
import { uptimeSummary } from "../lib/uptime";

import {
  instanceStateHistory, platformStateHistory, statusLabels,
  type DashboardStatus,
} from "../lib/status";

type InstancesViewProps = {
  platformId?: string;
};

function defaultPlatformName(platformId?: string) {
  if (!platformId) return "Foo";

  const match = /^platform-(\d+)$/.exec(platformId);
  return match ? `Platform ${match[1]}` : "Platform";
}

function displayInstanceName(instance: string) {
  try {
    return new URL(instance).hostname;
  } catch {
    return instance;
  }
}

function StatusBar({ status }: { status: DashboardStatus }) {
  const label = status === "warning" ? "Offline" : statusLabels[status];
  return (
    <span
      aria-label={label}
      title={label}
      className={`instance-status instance-status--${status}`}
      role="img"
    />
  );
}

export default function InstancesView({ platformId }: InstancesViewProps) {
  const router = useRouter();
  const { platforms, setPlatforms, error } = usePlatforms();
  const [deleteError, setDeleteError] = useState("");
  const [deletingUrl, setDeletingUrl] = useState("");
  const [deletingPlatform, setDeletingPlatform] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const platform = platforms.find((candidate) => candidate.id === platformId)
    ?? (!platformId ? platforms[0] : undefined)
    ?? { id: platformId ?? "", name: defaultPlatformName(platformId), instances: [] };
  const instances = platform.instances.map((instance) => ({
    url: instance,
    name: displayInstanceName(instance),
    healthUrl: platform.healthUrls?.[instance] ?? instance,
    history: instanceStateHistory(platform, instance),
    uptime: uptimeSummary(platform.uptime?.[instance], now ?? Date.now()),
  }));
  const platformUptime = uptimeSummary(platform.platformUptime, now ?? Date.now());
  const platformHistory = platformStateHistory(platform);
  const activityLabels = platformHistory.map(({ timestamp }, index) => {
    return timestamp && now !== null ? (
      <time key={index} dateTime={timestamp} title={new Date(timestamp).toLocaleString(undefined, { timeZoneName: "short" })}>
        {relativeCheckTime(timestamp, now)}
      </time>
    ) : <span key={index}>Time unavailable</span>;
  });

  const removeInstance = async (instanceUrl: string) => {
    if (!window.confirm(`Delete instance ${instanceUrl}? This cannot be undone.`)) return;
    setDeletingUrl(instanceUrl);
    setDeleteError("");
    try {
      await deleteInstance(platform.id, instanceUrl);
      setPlatforms((current) => current.map((candidate) => candidate.id === platform.id
        ? { ...candidate, instances: candidate.instances.filter((url) => url !== instanceUrl) }
        : candidate));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete instance.");
    } finally { setDeletingUrl(""); }
  };

  const removePlatform = async () => {
    if (!platform.id || !window.confirm(`Delete ${platform.name} and all of its instances? This cannot be undone.`)) return;
    setDeletingPlatform(true);
    setDeleteError("");
    try {
      await deletePlatform(platform.id);
      setPlatforms((current) => current.filter((candidate) => candidate.id !== platform.id));
      router.push("/dashboard");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete platform.");
      setDeletingPlatform(false);
    }
  };

  return (
    <main className="instances-page">
      <section className="platform-summary" aria-labelledby="platform-name">
        {platformId ? <Link className="instances-back-link" href="/dashboard">← Platforms</Link> : null}
        <h1 id="platform-name">Platform: {platform.name}</h1>
        <button className="delete-platform-button" disabled={!platform.id || deletingPlatform} onClick={() => void removePlatform()} type="button">
          {deletingPlatform ? "Deleting…" : "Delete platform"}
        </button>
        <p className="status-legend">Green: successful check · Amber: instance offline · Red: platform offline · Gray: unchecked</p>
        <p className="status-note">Checked every 10 seconds{platform.checkedAt ? ` · Last checked ${new Date(platform.checkedAt).toLocaleTimeString()}` : " · Awaiting first check"}</p>
        <p className={`platform-uptime platform-uptime--${platformUptime.meetsTarget === null ? "none" : platformUptime.meetsTarget ? "ok" : "below"}`}>{platformUptime.label} {platformUptime.coverage}{platformUptime.provisional ? " · provisional" : ""}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
        <div className="platform-history">
          <div className="status-stack">
            {platformHistory.map(({ status }, index) => (
              <StatusBar key={`${status}-${index}`} status={status} />
            ))}
          </div>
          <div className="activity-labels" aria-label="Activity times">
            {activityLabels}
          </div>
        </div>
      </section>

      <section className="instances-panel" aria-labelledby="instances-heading">
        <h2 id="instances-heading">Instances</h2>
        <p className="status-note">State changes, newest first. Repeated results keep the same box.</p>
        <p className="status-note">Uptime is the share of checks that succeeded in the last 30 days. Unknown results are not counted.</p>
        {instances.length ? (
          <div className="instances-overview">
            <div className="instance-columns">
              {instances.map((instance, instanceIndex) => (
                <article className="instance-column" key={`${instance.name}-${instanceIndex}`}>
                  <h3 title={instance.healthUrl}>{instance.name}</h3>
                  <p className="status-note">{instance.healthUrl}</p>
                  <p className={`instance-uptime platform-uptime--${instance.uptime.meetsTarget === null ? "none" : instance.uptime.meetsTarget ? "ok" : "below"}`}>{instance.uptime.label} {instance.uptime.coverage}{instance.uptime.provisional ? " · provisional" : ""}</p>
                  <button className="delete-instance-button" disabled={deletingUrl === instance.url} onClick={() => void removeInstance(instance.url)} type="button">
                    {deletingUrl === instance.url ? "Deleting…" : "Delete instance"}
                  </button>
                  <div className="status-stack">
                    {instance.history.map(({ status, timestamp }, index) => (
                      <div className="instance-transition" key={index}>
                        <StatusBar status={status} />
                        {timestamp && Number.isFinite(Date.parse(timestamp)) ? (
                          <time dateTime={timestamp} title={new Date(timestamp).toLocaleString(undefined, { timeZoneName: "short" })}>
                            {now !== null ? relativeCheckTime(timestamp, now) : "Loading time…"}
                          </time>
                        ) : <span>Time unavailable</span>}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="instances-empty-state">
            <p>No instances have been added to this platform.</p>
            <Link href="/dashboard">Back to platforms</Link>
          </div>
        )}
      </section>
    </main>
  );
}
