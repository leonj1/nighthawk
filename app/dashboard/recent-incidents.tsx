"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { incidentDuration, recentIncidents } from "../lib/incidents";
import type { Platform } from "../lib/status";

function EventTime({ value }: { value: string | null }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <>Time unavailable</>;
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}</time>;
}

export function RecentIncidents({ platforms, error }: { platforms: Platform[]; error: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const incidents = useMemo(() => recentIncidents(platforms), [platforms]);
  return (
    <section className="recent-incidents" aria-labelledby="recent-incidents-heading">
      <h2 id="recent-incidents-heading">Recent incidents</h2>
      <p className="status-note">Latest 10 instance outages, newest failure or recovery first. Times are local.</p>
      <p className="status-note">Squares show current instance health. Durations run from the first observed failure to confirmed recovery.</p>
      {error ? <p className="status-note">Incident history may be out of date while monitoring results are unavailable.</p> : null}
      {incidents.length ? (
        <ol className="incident-list">
          {incidents.map((incident, index) => (
            <li className="incident-row" key={`${incident.platformId}-${incident.instance}-${index}`}>
              <span className={`incident-square incident-square--${incident.currentStatus}`} role="img"
                aria-label={`Current instance state: ${incident.currentStatus === "critical" ? "down" : incident.currentStatus}`} />
              <div className="incident-body">
                <div className="incident-heading">
                  <Link href={`/instances/${encodeURIComponent(incident.platformId)}`}>{incident.platformName}</Link>
                  <span className={`incident-label incident-label--${incident.recovered ? "recovered" : "open"}`}>
                    {incident.recovered ? "Recovered" : incident.currentStatus === "unknown" ? "Recovery unconfirmed" : "Ongoing"}
                  </span>
                </div>
                <p className="incident-instance">{incident.instance}</p>
                <p className="incident-timing">{incident.recovered ? "Recovered " : "Started "}<EventTime value={incident.recovered ? incident.recoveredAt : incident.startedAt} /></p>
                <p className="incident-duration">
                  {incident.recovered ? "Was down for " : incident.currentStatus === "unknown" ? "Unresolved for " : "Down for "}
                  <strong>{now === null ? "…" : incidentDuration(incident, now)}</strong>
                  {incident.recovered ? <> · Started <EventTime value={incident.startedAt} /></> : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="incident-empty">{error ? "Unable to load incident history." : "No incidents in the available history."}</p>}
    </section>
  );
}
