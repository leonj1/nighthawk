const recentActivity = ["just now", "for 30 mins", "1 hour ago"];

const platformHistory = ["healthy", "warning", "healthy"] as const;

const instances = [
  {
    name: "Instance A",
    history: ["healthy", "warning", "healthy"] as const,
  },
  {
    name: "Instance B",
    history: ["healthy", "healthy", "healthy"] as const,
  },
];

function StatusBar({ status }: { status: "healthy" | "warning" }) {
  return (
    <span
      aria-label={status}
      className={`instance-status instance-status--${status}`}
      role="img"
    />
  );
}

export default function InstancesPage() {
  return (
    <main className="instances-page">
      <section className="platform-summary" aria-labelledby="platform-name">
        <h1 id="platform-name">Platform: Foo</h1>
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
        <div className="instances-overview">
          <div className="instance-columns">
            {instances.map((instance) => (
              <article className="instance-column" key={instance.name}>
                <h3>{instance.name}</h3>
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
      </section>
    </main>
  );
}
