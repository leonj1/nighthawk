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
