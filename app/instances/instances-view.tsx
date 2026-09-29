"use client";

import Link from "next/link";
import { usePlatforms } from "../lib/use-platforms";

import {
  instanceStatus, platformStatus, recentActivity, statusLabels,
  type CheckStatus,
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

function StatusBar({ status }: { status: CheckStatus }) {
  return (
    <span
      aria-label={statusLabels[status]}
      title={statusLabels[status]}
      className={`instance-status instance-status--${status}`}
      role="img"
    />
  );
}

export default function InstancesView({ platformId }: InstancesViewProps) {
  const { platforms, error } = usePlatforms();
  const platform = platforms.find((candidate) => candidate.id === platformId)
    ?? (!platformId ? platforms[0] : undefined)
    ?? { id: platformId ?? "", name: defaultPlatformName(platformId), instances: [] };
  const instances = platform.instances.map((instance) => ({
    name: displayInstanceName(instance),
    healthUrl: platform.healthUrls?.[instance] ?? instance,
    history: recentActivity.map((_, index) => instanceStatus(platform, instance, index)),
  }));
  const platformHistory = recentActivity.map((_, index) => platformStatus(platform, index));

  return (
    <main className="instances-page">
      <section className="platform-summary" aria-labelledby="platform-name">
        {platformId ? <Link className="instances-back-link" href="/dashboard">← Platforms</Link> : null}
        <h1 id="platform-name">Platform: {platform.name}</h1>
        <p className="status-legend">Green: successful check · Red: offline · Gray: unchecked</p>
        <p className="status-note">Checked every 10 seconds{platform.checkedAt ? ` · Last checked ${new Date(platform.checkedAt).toLocaleTimeString()}` : " · Awaiting first check"}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="platform-history">
          <div className="status-stack">
            {platformHistory.map((status, index) => (
              <StatusBar key={`${status}-${index}`} status={status} />
            ))}
          </div>
          <div className="activity-labels" aria-label="Activity times">
            {recentActivity.map((activity) => (
              <span key={activity}>{activity}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="instances-panel" aria-labelledby="instances-heading">
        <h2 id="instances-heading">Instances</h2>
        {instances.length ? (
          <div className="instances-overview">
            <div className="instance-columns">
              {instances.map((instance, instanceIndex) => (
                <article className="instance-column" key={`${instance.name}-${instanceIndex}`}>
                  <h3 title={instance.healthUrl}>{instance.name}</h3>
                  <p className="status-note">{instance.healthUrl}</p>
                  <div className="status-stack">
                    {instance.history.map((status, index) => (
                      <StatusBar key={`${status}-${index}`} status={status} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="activity-labels" aria-label="Activity times">
              {recentActivity.map((activity) => (
                <span key={activity}>{activity}</span>
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
