"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { incidentDuration, recentIncidents, sameAsPlatform, type Incident } from "../lib/incidents";
import type { Platform } from "../lib/status";

function EventTime({ value, format }: { value: string | null; format: "date" | "time" }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <>Time unavailable</>;
  const options = format === "date" ? { dateStyle: "medium" as const } : { timeStyle: "medium" as const };
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, options)}</time>;
}

type IncidentDay = { key: string; timestamp: string | null; incidents: Incident[] };

function groupIncidentDays(incidents: Incident[]): IncidentDay[] {
  const days = new Map<string, IncidentDay>();
  for (const incident of incidents) {
    const timestamp = incident.recovered ? incident.recoveredAt : incident.startedAt;
    const key = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toDateString() : "unavailable";
    const day = days.get(key);
    if (day) day.incidents.push(incident);
    else days.set(key, { key, timestamp, incidents: [incident] });
  }
  return [...days.values()];
}

function IncidentPlatform({ incident, repeated }: { incident: Incident; repeated: boolean }) {
  return (
    <td className="incident-platform">
      {repeated ? <span className="sr-only">{incident.platformName}</span> : (
        <Link href={`/instances/${encodeURIComponent(incident.platformId)}`}>{incident.platformName}</Link>
      )}
      {!sameAsPlatform(incident.instance, incident.platformName) ? (
        <p className="incident-instance">{incident.instance}</p>
      ) : null}
    </td>
  );
}

function IncidentRow({ incident, repeated, now }: { incident: Incident; repeated: boolean; now: number | null }) {
  const startedTitle = incident.startedAt && Number.isFinite(Date.parse(incident.startedAt))
    ? `Started ${new Date(incident.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}`
    : "Start time unavailable";
  return (
    <tr className="incident-row">
      <td className="incident-health"><span className={`incident-square incident-square--${incident.currentStatus}`} role="img"
        aria-label={`Current instance state: ${incident.currentStatus === "critical" ? "down" : incident.currentStatus}`} /></td>
      <IncidentPlatform incident={incident} repeated={repeated} />
      <td><span className={`incident-label incident-label--${incident.recovered ? "recovered" : "open"}`}>
        {incident.recovered ? "Recovered" : incident.currentStatus === "unknown" ? "Recovery unconfirmed" : "Ongoing"}
      </span></td>
      <td className="incident-timing" title={incident.recovered ? startedTitle : undefined}>
        <EventTime value={incident.recovered ? incident.recoveredAt : incident.startedAt} format="time" />
      </td>
      <td className="incident-duration" title={!incident.recovered && incident.currentStatus === "unknown" ? "Unresolved duration; recovery is unconfirmed" : undefined}>
        <strong>{now === null ? "…" : incidentDuration(incident, now)}</strong>
      </td>
      <td className="incident-timing incident-started">{incident.recovered ? <EventTime value={incident.startedAt} format="time" /> : null}</td>
    </tr>
  );
}

function IncidentTable({ days, now }: { days: IncidentDay[]; now: number | null }) {
  return (
    <div className="incident-table-scroll" role="region" aria-label="Recent incident details" tabIndex={0}>
      <table className="incident-table">
        <caption className="sr-only">Recent instance incidents</caption>
        <thead><tr>
          <th scope="col"><span className="sr-only">Current health</span></th>
          <th scope="col">Platform</th><th scope="col">Status</th>
          <th scope="col">Recovered / started</th><th scope="col">Down for</th>
          <th scope="col" className="incident-started">Started</th>
        </tr></thead>
        {days.map((day) => (
          <tbody key={day.key}>
            <tr className="incident-day"><th scope="rowgroup" colSpan={6}><EventTime value={day.timestamp} format="date" /></th></tr>
            {day.incidents.map((incident, index) => (
              <IncidentRow key={`${incident.platformId}-${incident.instance}-${index}`} incident={incident} now={now}
                repeated={index > 0 && day.incidents[index - 1].platformId === incident.platformId} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function RecentIncidents({ platforms, error }: { platforms: Platform[]; error: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const incidents = useMemo(() => recentIncidents(platforms), [platforms]);
  const days = useMemo(() => groupIncidentDays(incidents), [incidents]);
  return (
    <section className="recent-incidents" aria-labelledby="recent-incidents-heading">
      <h2 id="recent-incidents-heading">Recent incidents</h2>
      <p className="status-note">Latest 10 instance outages, newest failure or recovery first. Times are local; squares show current instance health; durations run from first observed failure to confirmed recovery.</p>
      {error ? <p className="status-note">Incident history may be out of date while monitoring results are unavailable.</p> : null}
      {incidents.length ? <IncidentTable days={days} now={now} /> : (
        <p className="incident-empty">{error ? "Unable to load incident history." : "No incidents in the available history."}</p>
      )}
    </section>
  );
}
