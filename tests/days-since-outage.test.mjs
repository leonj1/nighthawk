import assert from "node:assert/strict";
import { test } from "node:test";
import { daysSinceOutage } from "../app/lib/status.ts";

const day = 86_400_000;
const now = Date.parse("2026-10-04T12:00:00Z");
const ago = (days) => new Date(now - days * day).toISOString();
const state = (status, days) => ({ status, timestamp: ago(days) });
const platform = (history) => ({
  id: "p", name: "example.com", instances: ["a", "b"],
  checks: { a: [true, true, true], b: [true, true, true] },
  createdAt: ago(500), platformStateHistory: history,
});

test("recovery today shows zero, then increments only after a full day", () => {
  const data = platform([state("healthy", 0.5), state("critical", 2)]);
  assert.equal(daysSinceOutage(data, now), 0);
  assert.equal(daysSinceOutage(data, now + day / 2 - 1), 0);
  assert.equal(daysSinceOutage(data, now + day / 2), 1);
});

test("durable platform history counts 321 days since recovery outside the check window", () => {
  const data = platform([state("healthy", 321), state("critical", 325)]);
  const before = structuredClone(data);
  assert.equal(daysSinceOutage(data, now), 321);
  assert.deepEqual(data, before);
});

test("an ongoing outage always shows zero even when it began days ago", () => {
  const data = platform([state("critical", 12), state("healthy", 100)]);
  data.checks = { a: [false], b: [false] };
  assert.equal(daysSinceOutage(data, now), 0);
  // A current total failure also takes precedence over older saved history.
  data.platformStateHistory = [state("healthy", 100)];
  assert.equal(daysSinceOutage(data, now), 0);
});

test("the latest outage resets the count using its first confirmed recovery", () => {
  const data = platform([
    state("healthy", 1), state("unknown", 2), state("healthy", 3.5),
    state("unknown", 4), state("critical", 5),
    state("healthy", 321), state("critical", 325),
  ]);
  assert.equal(daysSinceOutage(data, now), 3);
});

test("unknown checks cannot prove that an outage recovered", () => {
  const data = platform([state("unknown", 1), state("critical", 10)]);
  data.checks = { a: [null], b: [false] };
  assert.equal(daysSinceOutage(data, now), 0);
});

test("partial instance failures do not reset the platform count", () => {
  const data = platform(undefined);
  data.checks = { a: [false, true, false], b: [true, false, true] };
  data.checkTimes = [ago(0), ago(1), ago(2)];
  assert.equal(daysSinceOutage(data, now), 500);
  data.platformStateHistory = [state("healthy", 321), state("critical", 325)];
  assert.equal(daysSinceOutage(data, now), 321);
});

test("legacy aligned checks use the existing total-outage definition", () => {
  const data = platform(undefined);
  data.checks = { a: [true, false, true], b: [false, false, true] };
  data.checkTimes = [ago(2), ago(3), ago(4)];
  assert.equal(daysSinceOutage(data, now), 2);
});

test("platforms without outages count from creation, with zero for unavailable dates", () => {
  const data = platform([state("healthy", 400), state("unknown", 500)]);
  assert.equal(daysSinceOutage(data, now), 500);
  delete data.createdAt;
  assert.equal(daysSinceOutage(data, now), 500);
  data.platformStateHistory = [{ status: "unknown", timestamp: null }];
  assert.equal(daysSinceOutage(data, now), 0);
});

test("missing, invalid or future recovery timestamps cannot produce invalid counts", () => {
  for (const timestamp of [null, "invalid", ago(-1)]) {
    const data = platform([{ status: "healthy", timestamp }, state("critical", 2)]);
    assert.equal(daysSinceOutage(data, now), 0);
  }
  assert.equal(daysSinceOutage(platform([state("healthy", 1), state("critical", 2)]), NaN), 0);
});
