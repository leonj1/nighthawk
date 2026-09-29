"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StoredPlatform = {
  id: string;
  name: string;
  instances: string[];
};

type InstancesViewProps = {
  platformId?: string;
};

const storageKey = "nighthawk-platforms";
const recentActivity = ["just now", "for 30 mins", "1 hour ago"];
const platformHistory = ["healthy", "warning", "healthy"] as const;
const demoInstances = [
  { name: "Instance A", history: ["healthy", "warning", "healthy"] as const },
  { name: "Instance B", history: ["healthy", "healthy", "healthy"] as const },
];

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

function StatusBar({ status }: { status: "healthy" | "warning" }) {
  return (
    <span
      aria-label={status}
      className={`instance-status instance-status--${status}`}
      role="img"
    />
  );
}

export default function InstancesView({ platformId }: InstancesViewProps) {
  const [platformName, setPlatformName] = useState(() => defaultPlatformName(platformId));
  const [instanceUrls, setInstanceUrls] = useState<string[] | null>(
    platformId ? [] : demoInstances.map((instance) => instance.name),
  );

  useEffect(() => {
    if (!platformId) return;

    try {
      const stored = window.localStorage.getItem(storageKey);
      const platforms = stored ? (JSON.parse(stored) as StoredPlatform[]) : [];
      const platform = platforms.find((candidate) => candidate.id === platformId);

      if (platform) {
        setPlatformName(platform.name);
        setInstanceUrls(platform.instances);
      }
    } catch {
      setInstanceUrls([]);
    }
  }, [platformId]);

  const instances = platformId
    ? (instanceUrls ?? []).map((instance) => ({
        name: displayInstanceName(instance),
        history: ["healthy", "healthy", "healthy"] as const,
      }))
    : demoInstances;

  return (
    <main className="instances-page">
      <section className="platform-summary" aria-labelledby="platform-name">
        {platformId ? <Link className="instances-back-link" href="/dashboard">← Platforms</Link> : null}
        <h1 id="platform-name">Platform: {platformName}</h1>
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
                  <h3 title={instance.name}>{instance.name}</h3>
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
