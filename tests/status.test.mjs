import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardStatus, instanceStatus, platformStatus, defaultPlatforms, platformStateHistory, sortDashboardPlatforms } from "../app/lib/status.ts";

function platform(a, b) {
  return { id: "test", name: "test.example.com", instances: ["a", "b"], checks: { a, b } };
}

test("dashboard sorts alphabetically regardless of status without mutating the source", () => {
  const data = [
    { ...platform([false], [false]), name: "Zulu.example.com" },
    { ...platform([true], [true]), name: "alpha.example.com" },
    { ...platform([], []), name: "Bravo.example.com" },
  ];
  const original = [...data];
  assert.deepEqual(sortDashboardPlatforms(data, "alphabetical").map((item) => item.name), [
    "alpha.example.com", "Bravo.example.com", "Zulu.example.com",
  ]);
  assert.deepEqual(data, original);
});

test("dashboard sorts outages, recovered outages, unchecked, then healthy with alphabetical ties", () => {
  const data = [
    { ...platform([true], [true]), name: "healthy" },
    { ...platform([], []), name: "unchecked" },
    { ...platform([true, false], [true, false]), name: "recovered" },
    { ...platform([false], [false]), name: "z-outage" },
    { ...platform([false], [false]), name: "a-outage" },
  ];
  assert.deepEqual(sortDashboardPlatforms(data, "status").map((item) => item.name), [
    "a-outage", "z-outage", "recovered", "unchecked", "healthy",
  ]);
  data[3].checks = { a: [true], b: [true] };
  assert.deepEqual(sortDashboardPlatforms(data, "status").map((item) => item.name), [
    "a-outage", "recovered", "unchecked", "healthy", "z-outage",
  ]);
  assert.deepEqual(sortDashboardPlatforms([], "status"), []);
});

test("dashboard sorts by platform SLA in both directions, with alphabetical ties and missing data last", () => {
  const sample = (good, samples) => ({ good, samples, firstSampleAt: "2026-09-01T00:00:00Z", lastSampleAt: "2026-09-30T00:00:00Z" });
  const data = [
    { ...platform([false], [false]), name: "perfect", platformUptime: sample(100, 100) },
    { ...platform([true], [true]), name: "low", platformUptime: sample(5, 10) },
    { ...platform([true], [true]), name: "z-tie", platformUptime: sample(995, 1000) },
    { ...platform([false], [false]), name: "Alpha-tie", platformUptime: sample(199, 200) },
    { ...platform([true], [true]), name: "zero", platformUptime: sample(0, 100) },
    { ...platform([], []), name: "z-missing" },
    { ...platform([], []), name: "a-empty", platformUptime: sample(0, 0) },
  ];
  const original = structuredClone(data);
  assert.deepEqual(sortDashboardPlatforms(data, "sla-ascending").map((item) => item.name), [
    "zero", "low", "Alpha-tie", "z-tie", "perfect", "a-empty", "z-missing",
  ]);
  assert.deepEqual(sortDashboardPlatforms(data, "sla-descending").map((item) => item.name), [
    "perfect", "Alpha-tie", "z-tie", "low", "zero", "a-empty", "z-missing",
  ]);
  assert.deepEqual(data, original);
  assert.deepEqual(sortDashboardPlatforms([], "sla-ascending"), []);
  assert.deepEqual(sortDashboardPlatforms([], "sla-descending"), []);
  // A polling update reorders the cards using the newly received uptime.
  data[1].platformUptime = sample(100, 100);
  assert.deepEqual(sortDashboardPlatforms(data, "sla-descending").slice(0, 2).map((item) => item.name), ["low", "perfect"]);
});

test("SLA sorts use the displayed percentage and platform totals rather than instance uptime", () => {
  const sample = (good) => ({ good, samples: 100000, firstSampleAt: "2026-09-01T00:00:00Z", lastSampleAt: "2026-09-30T00:00:00Z" });
  const data = [
    { ...platform([true], [true]), name: "zulu", platformUptime: sample(99999), uptime: { a: sample(0) } },
    { ...platform([false], [false]), name: "alpha", platformUptime: sample(99991), uptime: { a: sample(100000) } },
  ];
  for (const sort of ["sla-ascending", "sla-descending"]) {
    assert.deepEqual(sortDashboardPlatforms(data, sort).map((item) => item.name), ["alpha", "zulu"]);
  }
});

test("a successful instance keeps the platform green despite a failed instance", () => {
  const data = platform([true], [false]);
  assert.equal(instanceStatus(data, "a"), "healthy");
  assert.equal(instanceStatus(data, "b"), "critical");
  assert.equal(platformStatus(data), "healthy");
  assert.equal(dashboardStatus(data), "healthy");
});

test("all instances offline now takes precedence over window history", () => {
  const data = platform([false, false, true], [false, false, true]);
  assert.equal(platformStatus(data), "critical");
  assert.equal(dashboardStatus(data), "critical");
});

test("a recovered total outage is amber only on the dashboard", () => {
  const data = platform([true, false, true], [true, false, true]);
  assert.equal(dashboardStatus(data), "warning");
  assert.equal(platformStatus(data), "healthy");
  assert.equal(platformStatus(data, 1), "critical");
  assert.equal(instanceStatus(data, "a", 1), "critical");
});

test("failures at different times do not count as a total outage", () => {
  assert.equal(dashboardStatus(platform([true, false, true], [true, true, false])), "healthy");
});

test("missing checks and empty platforms cannot imply success or total outage", () => {
  for (const data of [platform([], []), platform([false], [null]), { id: "empty", name: "empty", instances: [] }]) {
    assert.equal(platformStatus(data), "unknown");
    assert.equal(dashboardStatus(data), "unknown");
  }
  const legacy = { id: "old", name: "old", instances: ["a"], status: "healthy" };
  assert.equal(instanceStatus(legacy, "a"), "unknown");
  assert.equal(dashboardStatus(legacy), "unknown");
});

test("outages outside the displayed window do not turn the dashboard amber", () => {
  assert.equal(dashboardStatus(platform([true, true, true, false], [true, true, true, false])), "healthy");
});

test("sample dashboard colors are derived from the same checks as details", () => {
  assert.deepEqual(defaultPlatforms.slice(0, 4).map(dashboardStatus), ["critical", "warning", "warning", "healthy"]);
});

test("platform transitions collapse repeated aggregate results across instances", () => {
  const data = platform([true, false, false, true], [false, true, false, false]);
  data.createdAt = "2026-09-30T00:00:00.000Z";
  data.checkTimes = [4, 3, 2, 1].map((second) => `2026-09-30T00:00:0${second}.000Z`);
  assert.deepEqual(platformStateHistory(data), [
    { status: "healthy", timestamp: data.checkTimes[1] },
    { status: "critical", timestamp: data.checkTimes[2] },
    { status: "healthy", timestamp: data.checkTimes[3] },
    { status: "unknown", timestamp: data.createdAt },
  ]);
  data.platformStateHistory = platformStateHistory(data);
  data.checks = { a: [true, true, true], b: [false, false, false] };
  assert.deepEqual(platformStateHistory(data), data.platformStateHistory);
});
