const platformStatuses = [
  "critical",
  "warning",
  "warning",
  "healthy",
  "healthy",
  ...Array.from({ length: 10 }, () => "healthy" as const),
] as const;

export default function Dashboard() {
  return (
    <main className="dashboard-page">
      <section className="platforms" aria-labelledby="platforms-heading">
        <h1 id="platforms-heading">Platforms</h1>
        <div className="platform-grid" aria-label="Platform status overview">
          {platformStatuses.map((status, index) => (
            <div
              aria-label={`Platform ${index + 1}: ${status}`}
              className={`platform-tile platform-tile--${status}`}
              key={index}
              role="img"
            />
          ))}
        </div>
      </section>
    </main>
  );
}
