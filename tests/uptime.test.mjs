import assert from "node:assert/strict";
import { test } from "node:test";
import { minimumUptimeSamples, uptimeCoverageDays, uptimePercent, uptimeSummary, uptimeTargetPercent, uptimeWindowDays } from "../app/lib/uptime.ts";

const day = 86_400_000;
const now = Date.parse("2026-09-30T12:00:00.000Z");
const sample = (good, samples, ageDays) => ({ good, samples, firstSampleAt: new Date(now - ageDays * day).toISOString(), lastSampleAt: new Date(now).toISOString() });

test("percentage is the same ratio at every age and floors without hiding failures", () => {
  for (const [good, samples, expected] of [[100, 100, 100], [0, 100, 0], [1, 3, 33.33], [99_999, 100_000, 99.99], [995, 1000, 99.5]]) {
    for (const age of [0.001, 1, 30, 365]) assert.equal(uptimePercent(sample(good, samples, age)), expected);
  }
  assert.equal(uptimePercent(undefined), null);
  assert.equal(uptimePercent(sample(0, 0, 1)), null);
});

test("coverage is clipped to the first sample, capped at 30 days, and resilient to skew", () => {
  for (const [age, expected] of [[0.0001, 1], [0.5, 1], [1, 1], [2.5, 3], [3, 3], [30.04, 30], [400, 30], [-1, 1]]) {
    assert.equal(uptimeCoverageDays(sample(1, 1, age), now), expected);
  }
  assert.equal(uptimeCoverageDays({ ...sample(1, 1, 3), firstSampleAt: "invalid" }, now), uptimeWindowDays);
});

test("summary exposes target, coverage, thin data and no-data state", () => {
  assert.deepEqual(uptimeSummary(undefined, now), { percent: null, label: "No uptime data", coverage: "", provisional: false, meetsTarget: null });
  assert.deepEqual(uptimeSummary(sample(25_920, 25_920, 3), now), { percent: 100, label: "100.00%", coverage: "over 3 of 30 days", provisional: false, meetsTarget: true });
  assert.equal(uptimeSummary(sample(258_000, 259_200, 45), now).label, "99.53%");
  assert.equal(uptimeSummary(sample(2_500, 2_600, 45), now).meetsTarget, false);
  assert.equal(uptimeSummary(sample(995, 1000, 30), now).meetsTarget, true, `exactly ${uptimeTargetPercent}% meets target`);
  assert.equal(uptimeSummary(sample(994, 1000, 30), now).meetsTarget, false);
  assert.equal(uptimeSummary(sample(5_000, 5_000, 0.99), now).provisional, true);
  assert.equal(uptimeSummary(sample(minimumUptimeSamples - 1, minimumUptimeSamples - 1, 2), now).provisional, true);
  assert.equal(uptimeSummary(sample(minimumUptimeSamples, minimumUptimeSamples, 1), now).provisional, false);
});
