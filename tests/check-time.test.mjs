import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTime, relativeCheckTime } from "../app/lib/check-time.ts";

test("check times show elapsed seconds, minutes, hours and days", () => {
  const timestamp = "2026-09-30T12:00:00.000Z";
  const start = Date.parse(timestamp);
  for (const [seconds, expected] of [
    [-1, "just now"], [0, "just now"], [1, "1 second ago"], [10, "10 seconds ago"],
    [59, "59 seconds ago"], [60, "1 minute ago"], [120, "2 minutes ago"],
    [3599, "59 minutes ago"], [3600, "1 hour ago"], [7200, "2 hours ago"],
    [86400, "1 day ago"], [172800, "2 days ago"],
  ]) {
    assert.equal(relativeCheckTime(timestamp, start + seconds * 1000), expected);
  }
});

test("timestamps use recorded history, including gaps, without inventing legacy times", () => {
  const latest = "2026-09-30T12:00:00.000Z";
  const previous = "2026-09-30T10:00:00.000Z";
  const platform = { checkedAt: latest, checkTimes: [latest, previous, null] };
  assert.equal(checkTime(platform, 0), latest);
  assert.equal(checkTime(platform, 1), previous);
  assert.equal(relativeCheckTime(checkTime(platform, 1), Date.parse(latest)), "2 hours ago");
  assert.equal(checkTime(platform, 2), undefined);
  assert.equal(checkTime({ checkedAt: latest }, 0), latest);
  assert.equal(checkTime({ checkedAt: latest }, 1), undefined);
  assert.equal(checkTime({}, 0), undefined);
  assert.equal(checkTime({ checkTimes: ["invalid"] }, 0), undefined);
});
