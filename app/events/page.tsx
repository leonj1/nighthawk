const activity = [
  { status: "healthy", label: "just now" },
  { status: "warning", label: "for 30 mins" },
  { status: "healthy", label: "1 hour ago" },
] as const;

const events = [
  {
    title:
      "Backend Stance Classifier Hardened After Repeated Decision-Tool Failures",
    time: "47m ago",
    description:
      "Vote evaluation was crashing whenever the local Needle stance classifier returned an unexpected decision tool instead of the required 'record_stance' call, triggering cascading ClassificationErrors across multiple agents. The work aimed to make the...",
    project: "Discussion-agents",
    category: "uncategorized",
    active: true,
  },
  {
    title:
      "Autonomous Multi-Agent Project Planning Feature Refined After Extended Design Review",
    time: "4h ago",
    description:
      "A developer's proposed plan for an autonomous AI agent workflow was scrutinized and substantially revised through discussion of UI placement, enterprise governance, termination conditions, and integration with the existing project's page.",
    project: "computer-wizard",
    category: "tools",
    active: true,
  },
  {
    title: "Agent Voting Feature Implemented and Pull Request Opened",
    time: "5h ago",
    description:
      "A Gherkin specification describing how AI agents in a chat room evaluate messages with binary reactions and check for newer messages before replying was written and implemented, resolving open questions about how agents determine their reactions.",
    project: "Discussion-agents",
    category: "uncategorized",
    active: true,
  },
  {
    title: "IP Geolocation via DB-IP Lite Integrated into the Project",
    time: "5h ago",
    description:
      "The project needed a free way to determine the region of inbound connection IP addresses, and the team pursued the DB-IP Lite database as a locally bundled solution.",
    project: "Discussion-agents",
    category: "uncategorized",
    active: false,
  },
] as const;

export default function EventsPage() {
  return (
    <main className="events-page">
      <aside className="events-instance" aria-labelledby="event-instance-name">
        <h1 id="event-instance-name">Instance A</h1>
        <div className="events-activity" aria-label="Instance activity">
          <div className="events-status-stack">
            {activity.map(({ status, label }) => (
              <span
                aria-label={`${status}, ${label}`}
                className={`event-status event-status--${status}`}
                key={label}
                role="img"
              />
            ))}
          </div>
          <div className="events-activity-labels" aria-hidden="true">
            {activity.map(({ label }) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </aside>

      <section className="events-panel" aria-labelledby="events-heading">
        <h2 id="events-heading">Events</h2>
        <div className="events-feed">
          <p className="events-date">Today</p>
          <div className="events-list">
            {events.map((event) => (
              <article className="event-item" key={event.title}>
                <div
                  aria-label={event.active ? "Active event" : "Inactive event"}
                  className={`event-dot${event.active ? "" : " event-dot--inactive"}`}
                  role="img"
                />
                <div className="event-content">
                  <div className="event-heading">
                    <h3>{event.title}</h3>
                    <time>{event.time}</time>
                  </div>
                  <p className="event-description">{event.description}</p>
                  <p className="event-meta">
                    {event.project} <span aria-hidden="true">·</span>{" "}
                    {event.category}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
