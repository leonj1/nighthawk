import assert from "node:assert/strict";
import { test } from "node:test";
import { groupIncidentDays, recentIncidents, incidentDuration, sameAsPlatform } from "../app/lib/incidents.ts";

const time = (seconds) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
const state = (status, seconds) => ({ status, timestamp: seconds === null ? null : time(seconds) });
const platform = (history, id = "p") => ({
  id, name: id, instances: ["a"], stateHistory: { a: history },
});

test("local day and hour groups follow recovery or failure time, preserve order, and keep unknown times", () => {
  const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
  const outage = (startedAt, recoveredAt = null) => ({
    platformId: "p", platformName: "Platform", instance: "a", currentStatus: "healthy",
    startedAt, recoveredAt, recovered: recoveredAt !== null,
  });
  const data = [
    outage(at(1, 23, 59), at(2, 0, 1)), outage(at(2, 0)), outage(at(1, 23, 59)),
    outage(at(1, 22)), outage(null), outage("invalid"),
  ];
  const before = structuredClone(data);
  const days = groupIncidentDays(data);
  assert.deepEqual(days.map((day) => day.count), [2, 2, 2]);
  assert.deepEqual(days.map((day) => day.hours.map((hour) => hour.incidents.length)), [[2], [1, 1], [2]]);
  assert.deepEqual(days[0].hours[0].incidents, data.slice(0, 2));
  assert.deepEqual(days[1].hours.flatMap((hour) => hour.incidents), data.slice(2, 4));
  assert.equal(days[2].key, "unavailable");
  assert.deepEqual(data, before);
  assert.deepEqual(groupIncidentDays([]), []);
});

test("falling back to a repeated local hour keeps separate groups with distinct offsets", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const data = ["2026-11-01T06:30:00Z", "2026-11-01T05:30:00Z"].map((startedAt) => ({
      platformId: "p", platformName: "Platform", instance: "a", currentStatus: "critical",
      startedAt, recoveredAt: null, recovered: false,
    }));
    const days = groupIncidentDays(data);
    assert.equal(days.length, 1);
    assert.equal(days[0].hours.length, 2);
    assert.notEqual(days[0].hours[0].key, days[0].hours[1].key);
    assert.deepEqual(days[0].hours.map((hour) => hour.incidents[0].startedAt), data.map((incident) => incident.startedAt));
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("matching instance hostnames ignore scheme, trailing slash, case and www", () => {
  for (const instance of ["https://example.com/", "http://example.com", "https://WWW.EXAMPLE.COM/"]) {
    assert.equal(sameAsPlatform(instance, "EXAMPLE.com"), true, instance);
    assert.equal(sameAsPlatform(instance, "www.example.com"), true, instance);
  }
});

test("different hosts and non-URL inputs keep their instance labels", () => {
  for (const instance of ["https://a.example.com", "https://example.net", "not a URL", "example.com", ""]) {
    assert.equal(sameAsPlatform(instance, "example.com"), false, instance);
  }
  assert.equal(sameAsPlatform("https://prod.example.com", "Prod"), false);
});

test("an ongoing outage retains its start and its duration grows", () => {
  const [incident] = recentIncidents([platform([state("warning", 10), state("healthy", 0)])]);
  assert.equal(incident.currentStatus, "critical");
  assert.equal(incident.recovered, false);
  assert.equal(incident.startedAt, time(10));
  assert.equal(incidentDuration(incident, Date.parse(time(75))), "1m 5s");
  assert.equal(incidentDuration(incident, Date.parse(time(80))), "1m 10s");
});

test("recovery closes one outage and freezes downtime, even beyond the raw check window", () => {
  const data = platform([state("healthy", 75), state("warning", 10), state("healthy", 0)]);
  data.checks = { a: [true, true, true] };
  const incidents = recentIncidents([data]);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].recoveredAt, time(75));
  assert.equal(incidents[0].currentStatus, "healthy");
  assert.equal(incidents[0].recovered, true);
  assert.equal(incidentDuration(incidents[0], Date.parse(time(999))), "1m 5s");
});

test("repeated failures and unknown checks do not invent recoveries", () => {
  const history = [state("unknown", 40), state("warning", 30), state("unknown", 20), state("warning", 10)];
  const [incident] = recentIncidents([platform(history)]);
  assert.equal(incident.currentStatus, "unknown");
  assert.equal(incident.startedAt, time(10));
  assert.equal(incident.recovered, false);
  const closed = recentIncidents([platform([state("healthy", 50), ...history])]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].recoveredAt, time(50));
});

test("separate outages remain separate with the actual current state on every row", () => {
  const incidents = recentIncidents([platform([
    state("warning", 40), state("healthy", 30), state("warning", 20), state("healthy", 10),
  ])]);
  assert.deepEqual(incidents.map((i) => [i.startedAt, i.recovered, i.currentStatus]), [
    [time(40), false, "critical"], [time(20), true, "critical"],
  ]);
});

test("latest ten are ordered globally by failure or recovery, independent of platform order", () => {
  const platforms = Array.from({ length: 12 }, (_, i) => platform([state("warning", i)], `p${i}`));
  platforms.push(platform([state("healthy", 20), state("warning", 0)], "recovered"));
  const before = structuredClone(platforms);
  const incidents = recentIncidents(platforms);
  assert.equal(incidents.length, 10);
  assert.equal(incidents[0].platformId, "recovered");
  assert.equal(incidents[1].platformId, "p11");
  assert.deepEqual(platforms, before);
});

test("healthy-only instances are excluded and partial platform failures are included", () => {
  assert.deepEqual(recentIncidents([platform([state("healthy", 20), state("unknown", 0)])]), []);
  assert.deepEqual(recentIncidents([]), []);
  const data = { id: "p", name: "Platform", instances: ["a", "b"], checks: { a: [true], b: [false] }, checkedAt: time(10) };
  const [incident] = recentIncidents([data]);
  assert.equal(incident.instance, "b");
  assert.equal(incident.startedAt, time(10));
});

test("missing or inconsistent times never fabricate durations or hide a recovery", () => {
  for (const history of [
    [state("warning", null)],
    [state("healthy", null), state("warning", 10)],
    [state("healthy", 5), state("warning", 10)],
  ]) {
    const [incident] = recentIncidents([platform(history)]);
    assert.equal(incidentDuration(incident, Date.parse(time(20))), "Duration unavailable");
    assert.equal(incident.recovered, history[0].status === "healthy");
  }
});
