import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardStatus, instanceStatus, platformStatus, defaultPlatforms } from "../app/lib/status.ts";

function platform(a, b) {
  return { id: "test", name: "test.example.com", instances: ["a", "b"], checks: { a, b } };
}

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
