# Plan: 30-day rolling uptime (SLI/SLO) per instance and platform

## Summary

Add a rolling 30-day uptime figure for every instance and every platform.
The SLI is **healthy checks ÷ known checks** over the last 30 days. One
formula for every instance regardless of age. A newly added instance has fewer
samples, so its window is clipped automatically; the UI shows the coverage
("over 3 of 30 days") next to the number and marks thin data as provisional.

## Blocking finding in the current code

`PlatformStore.recordCycle` (`app/lib/server/storage.ts`) deletes all but the
newest 3 `check_runs` per platform on every cycle, and `insert()` keeps at most
3 legacy runs. `check_results` therefore never holds more than 3 samples per
instance. The SQL sketched in the design discussion (`COUNT` over
`check_results` for 30 days) would always report at most 3 samples.

Keeping raw rows for 30 days is not viable either: checks run every 10 s, so
one instance produces 259,200 rows per 30 days, and the dashboard polls every
10 s. Counting that on each poll is too slow on a Railway volume.

**Decision:** keep the 3-run raw retention unchanged (the dashboard still needs
aligned cycles) and add **hourly roll-up buckets** that store only counts.
The SLI formula is still "sum of good ÷ sum of known"; the buckets are the
storage of those counts, not a different formula. 30 days = 720 rows per
instance, read in one indexed `SUM`.

## Design

### Data model (schema version 2)

```sql
CREATE TABLE instance_check_buckets (
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,                  -- hour start, ISO 8601 UTC
  good INTEGER NOT NULL,                 -- healthy = 1
  total INTEGER NOT NULL,                -- healthy IS NOT NULL
  first_checked_at TEXT NOT NULL,        -- normalized ISO UTC
  last_checked_at TEXT NOT NULL,
  PRIMARY KEY(instance_id, bucket)
) STRICT;
CREATE TABLE platform_check_buckets (
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL, good INTEGER NOT NULL, total INTEGER NOT NULL,
  first_checked_at TEXT NOT NULL, last_checked_at TEXT NOT NULL,
  PRIMARY KEY(platform_id, bucket)
) STRICT;
CREATE INDEX instance_buckets_recent ON instance_check_buckets(instance_id, last_checked_at);
CREATE INDEX platform_buckets_recent ON platform_check_buckets(platform_id, last_checked_at);
```

Rules:

- A cycle contributes to an instance bucket only when its result is `true`
  or `false`. `null` (unknown) touches neither numerator nor denominator.
- A cycle contributes to the platform bucket when at least one instance result
  is known. It is "good" when at least one instance is healthy. This matches
  `platformStatus`: one healthy instance means the platform is up.
- A cycle whose `checked_at` is `null` is stored in `check_runs` as today but
  is **not** tallied: it cannot be placed in time.
- Timestamps are normalized with `new Date(value).toISOString()` before
  storage, so `MIN`/`MAX` on the text columns compare correctly even when a
  legacy timestamp used an offset.
- On every tallied cycle, buckets whose `last_checked_at` is older than
  `checkedAt − 30 days` are deleted for that platform and its instances.
  Pruning uses the cycle's own timestamp as "now", never the wall clock, so
  tests and replays are deterministic.
- Migration from version 1 creates the tables, backfills them from the ≤3
  retained runs that have a timestamp, and sets `user_version = 2`. Opening
  version 3 or later still fails closed.
- `insert()` (legacy JSON import) tallies the ≤3 imported runs through the
  same helper, skipping runs with a `null` time.

### Read path

`PlatformStore.list(now = new Date().toISOString())` gains an optional
`now`. For each platform it runs one `SUM` query per instance plus one for the
platform, selecting buckets with `last_checked_at >= now − 30 days`.

The platform object gains two optional fields, present only when at least one
sample exists in the window (mirrors how `checks` is omitted until the first
run, so existing `deepEqual` tests on fresh platforms are unaffected):

```ts
// app/lib/status.ts
export type UptimeSample = { good: number; samples: number; firstSampleAt: string; lastSampleAt: string };
export type Platform = {
  ...
  uptime?: Record<string, UptimeSample>;   // keyed by instance URL like `checks`
  platformUptime?: UptimeSample;
};
```

Boundary note: the straddling bucket is included whole, so up to one hour of
samples just before the window start can be counted, and `firstSampleAt` may
be up to one hour before `now − 30 days`. Coverage is capped at 30 days in the
UI. This is documented and tested, not hidden.

### Pure presentation helper (`app/lib/uptime.ts`)

Server returns counts; the browser formats. Keeping this in a dependency-free
module makes it unit-testable with `node:test` like `check-time.ts`.

```ts
export const uptimeWindowDays = 30;
export const uptimeTargetPercent = 99.5;
export const minimumUptimeSamples = 60;          // ten minutes of 10 s checks
const day = 86_400_000;

// Floor, not round: 99.996% must not display as 100.00%. Integer math first so
// 995/1000 is exactly 99.50 and compares equal to the target.
export function uptimePercent(sample?: UptimeSample): number | null {
  if (!sample || sample.samples <= 0) return null;
  return Math.floor((sample.good * 10_000) / sample.samples) / 100;
}

// Whole days of coverage, at least 1, at most the window. Invalid timestamps give the window.
export function uptimeCoverageDays(sample: UptimeSample, now: number): number { ... }

export type UptimeSummary = {
  percent: number | null;        // null when there is no data
  label: string;                 // "99.80%" or "No uptime data"
  coverage: string;              // "over 3 of 30 days" or ""
  provisional: boolean;          // under one full day or under minimumUptimeSamples
  meetsTarget: boolean | null;   // null when there is no data
};
export function uptimeSummary(sample: UptimeSample | undefined, now: number): UptimeSummary
```

There is deliberately **no branch on age** inside `uptimePercent`. Age only
affects `coverage` and `provisional`.

### UI

- `app/dashboard/page.tsx`: each platform card gets
  `<p className="platform-uptime platform-uptime--{ok|below|none}" title={coverage}>{label}{provisional ? " · provisional" : ""}</p>`.
- `app/instances/instances-view.tsx`: the platform summary shows the platform
  uptime with coverage; each instance column shows its own uptime line
  (`class="instance-uptime"`). Both use the `now` state already in the view.
- `app/globals.css`: three small classes; red text for `--below`, muted for `--none`.
- Status note text: "Uptime is the share of checks that succeeded in the last
  30 days. Unknown results are not counted."

### Docs

README: replace "the latest three aligned check cycles" paragraph with a
sentence on the hourly roll-ups, the 30-day window, pruning, and the fact that
the window is clipped to the first check for new instances. DEPLOYMENT.md:
note the schema bump to 2 and that the backup script needs no change.

## Implementation steps (TDD order)

1. **Pure helper + tests.** Add `app/lib/uptime.ts` and `tests/uptime.test.mjs`
   (below). These pass with no storage changes.
2. **Schema and tally.** Add the two tables to `schema`, bump `user_version`
   to 2, add the `version === 1` migration branch, add a private
   `tally(platformId, results: {id, result}[], checkedAt)` used by
   `recordCycle` and `insert`. Add pruning to `tally`.
3. **Read path.** Extend `list(now?)` to populate `uptime` and
   `platformUptime`. Update the two existing storage tests that assert
   `user_version` (1 → 2) and the "future schema" probe (2 → 3).
4. **Storage tests.** Add the storage tests below. Run `npm test`.
5. **Monitor and API tests.** Extend the existing monitor and API tests.
6. **UI.** Dashboard card and instances view. Add the BDD feature and steps.
   Run `npm run test:bdd`, `npm run typecheck`, `npm run build`.
7. **Docs.** README and DEPLOYMENT.md.

## Tests

All tests use the repository's existing conventions: `node:test`, temp
directories inside the workspace, injected clocks, raw `DatabaseSync` for
schema assertions, and rendering the real view through SWC for BDD.

### `tests/uptime.test.mjs` (new)

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { minimumUptimeSamples, uptimeCoverageDays, uptimePercent, uptimeSummary, uptimeTargetPercent, uptimeWindowDays } from "../app/lib/uptime.ts";

const day = 86_400_000;
const now = Date.parse("2026-09-30T12:00:00.000Z");
const sample = (good, samples, ageDays) => ({ good, samples, firstSampleAt: new Date(now - ageDays * day).toISOString(), lastSampleAt: new Date(now).toISOString() });

test("the percentage is the plain ratio of good to known checks, floored to two decimals", () => {
  assert.equal(uptimePercent(sample(100, 100, 3)), 100);
  assert.equal(uptimePercent(sample(0, 100, 3)), 0);
  assert.equal(uptimePercent(sample(1, 3, 3)), 33.33);
  assert.equal(uptimePercent(sample(99_999, 100_000, 30)), 99.99, "one failure in 100000 must not round up to 100");
  assert.equal(uptimePercent(sample(995, 1000, 30)), 99.5, "exact target must not be lost to floating point");
  assert.equal(uptimePercent(sample(199, 200, 30)), 99.5);
});

test("no samples means no number, never 100% or 0%", () => {
  assert.equal(uptimePercent(undefined), null);
  assert.equal(uptimePercent({ good: 0, samples: 0, firstSampleAt: "", lastSampleAt: "" }), null);
  const summary = uptimeSummary(undefined, now);
  assert.deepEqual(summary, { percent: null, label: "No uptime data", coverage: "", provisional: false, meetsTarget: null });
});

test("the same counts give the same percentage regardless of the instance's age", () => {
  for (const [good, samples] of [[0, 1], [1, 1], [7, 9], [995, 1000], [259_000, 259_200]]) {
    const percents = new Set([0.001, 1, 3, 29, 30, 365].map((age) => uptimePercent(sample(good, samples, age))));
    assert.equal(percents.size, 1, `${good}/${samples} must not depend on age`);
  }
});

test("coverage is clipped to the first sample for new instances and capped at the window for old ones", () => {
  assert.equal(uptimeCoverageDays(sample(1, 1, 0.0001), now), 1, "anything under a day reads as 1 day");
  assert.equal(uptimeCoverageDays(sample(1, 1, 0.5), now), 1);
  assert.equal(uptimeCoverageDays(sample(1, 1, 1), now), 1);
  assert.equal(uptimeCoverageDays(sample(1, 1, 2.5), now), 3);
  assert.equal(uptimeCoverageDays(sample(1, 1, 3), now), 3);
  assert.equal(uptimeCoverageDays(sample(1, 1, 30), now), 30);
  assert.equal(uptimeCoverageDays(sample(1, 1, 30.04), now), 30, "the straddling bucket may start up to an hour early");
  assert.equal(uptimeCoverageDays(sample(1, 1, 400), now), uptimeWindowDays);
  assert.equal(uptimeCoverageDays({ ...sample(1, 1, 3), firstSampleAt: "invalid" }, now), uptimeWindowDays, "unparseable time falls back to the full window");
  assert.equal(uptimeCoverageDays(sample(1, 1, -1), now), 1, "a future first sample (clock skew) never yields zero or negative coverage");
});

test("summary labels carry the percentage, the coverage and the target verdict", () => {
  const healthy = uptimeSummary(sample(25_920, 25_920, 3), now);
  assert.deepEqual(healthy, { percent: 100, label: "100.00%", coverage: "over 3 of 30 days", provisional: false, meetsTarget: true });
  const degraded = uptimeSummary(sample(258_000, 259_200, 45), now);
  assert.equal(degraded.label, "99.53%");
  assert.equal(degraded.coverage, "over 30 of 30 days");
  assert.equal(degraded.meetsTarget, true);
  const failing = uptimeSummary(sample(2_500, 2_600, 45), now);
  assert.equal(failing.label, "96.15%");
  assert.equal(failing.meetsTarget, false);
  assert.equal(uptimeSummary(sample(199, 200, 30), now).meetsTarget, true, `exactly ${uptimeTargetPercent}% meets the target`);
  assert.equal(uptimeSummary(sample(994, 1000, 30), now).meetsTarget, false);
});

test("thin data is provisional: under one full day or under the minimum sample count", () => {
  assert.equal(uptimeSummary(sample(1, 1, 0.0001), now).provisional, true, "one sample, seconds old");
  assert.equal(uptimeSummary(sample(minimumUptimeSamples - 1, minimumUptimeSamples - 1, 2), now).provisional, true, "two days old but too few samples (monitor was mostly down)");
  assert.equal(uptimeSummary(sample(5_000, 5_000, 0.99), now).provisional, true, "many samples but under a day");
  assert.equal(uptimeSummary(sample(minimumUptimeSamples, minimumUptimeSamples, 1), now).provisional, false, "exactly one day and exactly the minimum samples");
  assert.equal(uptimeSummary(sample(60, 60, 30), now).provisional, false);
  assert.equal(uptimeSummary(sample(0, 60, 1), now).provisional, false, "a fully failing instance is still a confident number");
});
```

### `tests/storage.test.mjs` (additions)

Add to the existing helpers:

```js
const day = (days, seconds = 0) => new Date(Date.UTC(2026, 0, 1 + days, 0, 0, seconds)).toISOString();
const cycleAt = (store, results, at, id = "p") => store.recordCycle(id, results, at, store.revision(id));
const buckets = (db, table = "instance_check_buckets") => db.prepare(`SELECT * FROM ${table} ORDER BY bucket`).all();
```

Change two existing assertions: the JSON migration test now expects
`user_version` 2, and the "future schemas fail closed" test sets
`user_version = 3` and also asserts that reopening a database forced back to
version 1 (bucket tables dropped) re-creates them and backfills.

```js
test("uptime counts every tallied cycle even though only three raw runs are retained", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  assert.equal(store.list()[0].uptime, undefined, "no samples yet means no uptime field, never 100%");
  const results = [true, true, false, true, true, true, null, true, false, true];
  results.forEach((r, i) => cycle(store, { [url]: r }, i * 10));
  const p = store.list()[0]; const db = f.raw();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM check_runs").get().n, 3, "raw retention is unchanged");
  assert.deepEqual(p.uptime[url], { good: 7, samples: 9, firstSampleAt: time(0), lastSampleAt: time(90) }, "unknown is excluded from both numerator and denominator");
  assert.deepEqual(p.platformUptime, { good: 7, samples: 9, firstSampleAt: time(0), lastSampleAt: time(90) });
  assert.equal(buckets(db).length, 1, "ten cycles in the same hour share one bucket");
  assert.deepEqual(f.reopen().list(), [p]);
});

test("a new instance is clipped to its first check and shares the formula with an old one", (t) => {
  const f = fixture(t); const store = f.open();
  store.add([platform("old")]);
  for (let d = 0; d < 20; d++) cycleAt(store, { [url]: d !== 10 }, day(d), "old");
  store.add([platform("new")]);
  for (let d = 17; d < 20; d++) cycleAt(store, { [url]: d !== 18 }, day(d), "new");
  const now = day(20);
  const [newer, older] = ["new", "old"].map((id) => store.list(now).find((p) => p.id === id));
  assert.deepEqual(older.uptime[url], { good: 19, samples: 20, firstSampleAt: day(0), lastSampleAt: day(19) });
  assert.deepEqual(newer.uptime[url], { good: 2, samples: 3, firstSampleAt: day(17), lastSampleAt: day(19) }, "denominator is only the checks that exist");
  assert.equal(f.raw().prepare("SELECT COUNT(*) AS n FROM instance_check_buckets WHERE total = 0").get().n, 0, "no padding rows are ever written");
});

test("the window is rolling: samples older than 30 days leave the result and are pruned from disk", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: false }, day(0));
  cycleAt(store, { [url]: true }, day(29, 86_399));
  assert.deepEqual(store.list(day(30))[0].uptime[url], { good: 1, samples: 2, firstSampleAt: day(0), lastSampleAt: day(29, 86_399) }, "29.99 days apart are both inside the window");
  assert.deepEqual(store.list(day(31))[0].uptime[url], { good: 1, samples: 1, firstSampleAt: day(29, 86_399), lastSampleAt: day(29, 86_399) }, "list(now) excludes the old bucket before any cycle prunes it");
  assert.equal(buckets(f.raw()).length, 2, "reads never delete");
  cycleAt(store, { [url]: true }, day(31));
  assert.equal(buckets(f.raw()).length, 2, "the day-0 bucket is pruned by the first cycle outside its window");
  assert.deepEqual(buckets(f.raw()).map((b) => b.bucket), [day(29, 82_800), day(31)]);
  assert.equal(buckets(f.raw(), "platform_check_buckets").length, 2);
});

test("a bucket straddling the window edge is included whole; nothing is split", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: false }, day(0, 0));      // 00:00
  cycleAt(store, { [url]: true }, day(0, 3_000));   // 00:50, same hour bucket
  const now = day(30, 1_500);                        // window start is 00:25 on day 0
  assert.deepEqual(store.list(now)[0].uptime[url], { good: 1, samples: 2, firstSampleAt: day(0, 0), lastSampleAt: day(0, 3_000) }, "documented over-inclusion of at most one hour");
  assert.equal(store.list(day(30, 3_001))[0].uptime, undefined, "once the whole bucket is older than the window it is gone");
});

test("monitor downtime creates a gap, not instance downtime", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: true }, day(0));
  cycleAt(store, { [url]: true }, day(5));
  assert.deepEqual(store.list(day(6))[0].uptime[url], { good: 2, samples: 2, firstSampleAt: day(0), lastSampleAt: day(5) });
  assert.equal(buckets(f.raw()).length, 2, "no buckets are invented for hours without checks");
});

test("cycles without a timestamp are stored as checks but never tallied", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  assert.equal(store.recordCycle("p", { [url]: true }, null, 0), true);
  const p = store.list()[0];
  assert.deepEqual(p.checks[url], [true]);
  assert.deepEqual(p.checkTimes, [null]);
  assert.equal(p.uptime, undefined);
  assert.equal(buckets(f.raw()).length, 0);
});

test("platform uptime counts a cycle as good when any instance is healthy and skips all-unknown cycles", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("p", [url, second])]);
  const cases = [[true, false], [true, null], [false, null], [null, null], [false, false], [true, true]];
  cases.forEach(([a, b], i) => cycle(store, { [url]: a, [second]: b }, i * 10));
  const p = store.list()[0];
  assert.deepEqual(p.platformUptime, { good: 3, samples: 5, firstSampleAt: time(0), lastSampleAt: time(50) });
  assert.deepEqual(p.uptime[url], { good: 3, samples: 5, firstSampleAt: time(0), lastSampleAt: time(50) });
  assert.deepEqual(p.uptime[second], { good: 1, samples: 3, firstSampleAt: time(0), lastSampleAt: time(50) }, "instances with different results in the same hour keep separate rows");
  assert.equal(buckets(f.raw()).length, 2);
});

test("an instance that only ever reported unknown has no uptime while its sibling does", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("p", [url, second])]);
  cycle(store, { [url]: true, [second]: null });
  const p = store.list()[0];
  assert.deepEqual(p.uptime[url], { good: 1, samples: 1, firstSampleAt: time(10), lastSampleAt: time(10) });
  assert.equal(p.uptime[second], undefined, "absent, not 0/0 and not 100%");
  assert.ok(p.platformUptime);
});

test("timestamps with offsets are normalized so min/max and window comparisons stay correct", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: true }, "2026-01-01T02:00:00+02:00");   // 00:00Z
  cycleAt(store, { [url]: false }, "2026-01-01T00:30:00.000Z");
  const p = store.list(day(1))[0];
  assert.deepEqual(p.uptime[url], { good: 1, samples: 2, firstSampleAt: day(0), lastSampleAt: day(0, 1_800) });
  assert.deepEqual(buckets(f.raw()).map((b) => b.bucket), [day(0)]);
});

test("an out-of-order older timestamp is tallied into its own hour and does not prune newer data", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: true }, day(10));
  cycleAt(store, { [url]: false }, day(9));
  assert.deepEqual(store.list(day(11))[0].uptime[url], { good: 1, samples: 2, firstSampleAt: day(9), lastSampleAt: day(10) });
  assert.equal(buckets(f.raw()).length, 2);
});

test("failed and stale cycles leave buckets untouched", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycle(store, { [url]: true }, 0);
  const before = buckets(f.raw()); const db = f.raw();
  db.exec("CREATE TRIGGER fail_cycle BEFORE UPDATE ON platforms BEGIN SELECT RAISE(ABORT, 'cycle failure'); END");
  assert.throws(() => cycle(store, { [url]: false }, 10), /cycle failure/);
  db.exec("DROP TRIGGER fail_cycle");
  assert.equal(store.recordCycle("p", { [url]: false }, time(20), 0), false, "stale revision");
  assert.deepEqual(buckets(db), before);
  assert.deepEqual(store.list()[0].uptime[url], { good: 1, samples: 1, firstSampleAt: time(0), lastSampleAt: time(0) });
});

test("deleting a platform cascades to its buckets", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("p", [url, second])]);
  cycle(store, { [url]: true, [second]: false });
  const db = f.raw();
  db.prepare("DELETE FROM platforms WHERE id = 'p'").run();
  assert.equal(buckets(db).length, 0);
  assert.equal(buckets(db, "platform_check_buckets").length, 0);
});

test("legacy JSON import tallies only the retained runs that have timestamps", (t) => {
  const p = platform();
  p.checkedAt = time(20); p.checkTimes = [time(20), time(10), null]; p.checks = { [url]: [true, false, null] };
  const f = fixture(t, [p]); const store = f.open();
  assert.deepEqual(store.list()[0].uptime[url], { good: 1, samples: 1, firstSampleAt: time(20), lastSampleAt: time(20) }, "the untimed run is not counted; the null result is unknown");
  const untimed = fixture(t, [{ id: "u", name: "u", instances: [url], checks: { [url]: [true, true, true] } }]);
  assert.equal(untimed.open().list()[0].uptime, undefined, "older JSON without times contributes nothing");
});

test("a version 1 database upgrades in place, backfills retained runs, and later versions fail closed", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  for (const [i, r] of [true, false, true, true].entries()) cycle(store, { [url]: r }, i * 10);
  const expected = store.list();
  const db = f.raw();
  db.exec("DROP TABLE instance_check_buckets; DROP TABLE platform_check_buckets; PRAGMA user_version = 1");
  const upgraded = f.reopen();
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.deepEqual(upgraded.list()[0].uptime[url], { good: 2, samples: 3, firstSampleAt: time(10), lastSampleAt: time(30) }, "only the three retained runs can be recovered");
  assert.deepEqual({ ...upgraded.list()[0], uptime: undefined, platformUptime: undefined }, { ...expected, uptime: undefined, platformUptime: undefined });
  db.exec("PRAGMA user_version = 3");
  assert.throws(() => new PlatformStore(f.directory), /Unsupported SQLite schema/);
});

test("list(now) is read-only and rejects an invalid clock", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycle(store, { [url]: true });
  assert.throws(() => store.list("not a date"), /timestamp/);
  assert.deepEqual(store.list(time(10)), store.list(time(10)));
});
```

### `tests/monitor.test.mjs` (additions to the existing "monitor imports instances" test)

```js
    // after the four ticks against the refused 127.0.0.1 probe:
    assert.deepEqual({ good: platforms[0].uptime["http://127.0.0.1/"].good, samples: platforms[0].uptime["http://127.0.0.1/"].samples }, { good: 0, samples: 4 });
    assert.equal(platforms[0].uptime["http://127.0.0.1/"].lastSampleAt, platforms[0].checkedAt);
    assert.deepEqual(platforms[0].platformUptime.samples, 4);
```

And a new test using the injected clock, placed in `tests/storage.test.mjs`
next to the other `Monitor` tests:

```js
test("the monitor's injected clock drives bucket placement and a timed-out probe counts as a failed sample", async (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  let n = 0;
  const monitor = new Monitor(store, async () => n % 2 === 0, () => day(0, n++ * 3_600));
  for (let i = 0; i < 4; i++) await monitor.tick();
  assert.equal(buckets(f.raw()).length, 4, "one bucket per hour");
  assert.deepEqual(store.list(day(1))[0].uptime[url], { good: 2, samples: 4, firstSampleAt: day(0), lastSampleAt: day(0, 10_800) });
  const slow = new Monitor(store, () => new Promise(() => {}), () => day(0, 14_400), 5);
  await slow.tick();
  assert.equal(store.list(day(1))[0].uptime[url].samples, 5, "a timeout is a real failed check, not unknown");
  assert.equal(store.list(day(1))[0].uptime[url].good, 2);
});
```

### `tests/api.test.mjs` (additions)

```js
    // after `saved` is read:
    assert.equal(saved[0].uptime, undefined, "a freshly created platform exposes no uptime until a tallied cycle");
    assert.equal(saved[0].platformUptime, undefined);
    // after a controlled tick with the always-false probe:
    await globalThis.nighthawkMonitor.tick();
    const listed = await (await GET()).json(); globalThis.nighthawkMonitor.stop();
    assert.deepEqual(Object.keys(listed[0].uptime), ["https://example.com/"]);
    assert.equal(listed[0].uptime["https://example.com/"].good, 0);
    assert.equal(listed[0].uptime["https://example.com/"].samples, 1);
    assert.equal(listed[0].platformUptime.samples, 1);
    assert.ok(Number.isFinite(Date.parse(listed[0].platformUptime.firstSampleAt)));
```

### `tests/features/uptime-window.feature` (new) and `tests/features/steps/uptime-window.mjs`

The steps reuse `renderView(platform, now)` from
`steps/instance-state-history.mjs` and compile `app/dashboard/page.tsx` the
same way, stubbing `../lib/use-platforms`, `../lib/health-url`, and `next/link`.

```gherkin
Feature: Rolling 30-day uptime
  Uptime is the share of health checks that succeeded during the last 30 days.
  One formula applies to every instance. A new instance is measured over the
  checks it actually has, and the view says how much of the window that covers.
  Unknown results are not counted. Thin data is marked provisional.

  Background:
    Given the clock reads "2026-09-30T12:00:00.000Z"

  Scenario: An instance with no completed checks shows no number
    Given a platform whose instance has no tallied checks
    Then the instance uptime reads "No uptime data"
    And the platform uptime reads "No uptime data"
    And the dashboard tile uptime reads "No uptime data"

  Scenario: A three-day-old instance is measured over three days
    Given an instance first checked 3 days ago with 25920 good checks out of 25920
    Then the instance uptime reads "100.00%"
    And the instance uptime coverage reads "over 3 of 30 days"
    And the instance uptime is not provisional

  Scenario: An instance older than the window is measured over the full window
    Given an instance first checked 400 days ago with 258000 good checks out of 259200
    Then the instance uptime reads "99.53%"
    And the instance uptime coverage reads "over 30 of 30 days"
    And the instance uptime meets the target

  Scenario: An instance below target is flagged on the dashboard
    Given an instance first checked 30 days ago with 2500 good checks out of 2600
    Then the dashboard tile uptime reads "96.15%"
    And the dashboard tile is marked below target

  Scenario: Seconds-old data is provisional but still shown
    Given an instance first checked 20 seconds ago with 2 good checks out of 2
    Then the instance uptime reads "100.00%"
    And the instance uptime coverage reads "over 1 of 30 days"
    And the instance uptime is provisional

  Scenario: One failure in a hundred thousand does not display as perfect
    Given an instance first checked 30 days ago with 99999 good checks out of 100000
    Then the instance uptime reads "99.99%"

  Scenario: Unknown results neither help nor hurt
    Given an instance first checked 1 day ago with 7 good checks out of 9 and 4 unknown results
    Then the instance uptime reads "77.77%"

  Scenario: The platform is up when any instance is up
    Given two instances where the first succeeded 3 of 4 checks and the second succeeded 1 of 4 checks, never both failing
    Then the platform uptime reads "100.00%"
    And the first instance uptime reads "75.00%"
    And the second instance uptime reads "25.00%"
```

Step notes:

- "with N good checks out of M" builds `uptime[url] = { good, samples, firstSampleAt, lastSampleAt }`
  directly. The BDD layer tests presentation; storage tests above prove the
  counts. The "and 4 unknown results" step must leave `samples` unchanged
  (asserting the step author did not add unknowns to the denominator).
- "the dashboard tile uptime reads" matches `class="platform-uptime[^"]*"[^>]*>([^<]*)<`
  inside the `<a class="platform-card">` for the platform.
- "is marked below target" asserts the class `platform-uptime--below`.
- The two-instance scenario supplies `platformUptime` as `{ good: 4, samples: 4 }`
  and documents in the step that storage derives it with any-healthy semantics.

### Existing tests to update

| Test | Change |
|---|---|
| storage: "current JSON migration preserves…" | `user_version` 1 → 2 |
| storage: "interrupted import rolls back; existing schema upgrades…" | probe `user_version = 3` instead of 2 |
| README verification section | mention `tests/uptime.test.mjs` and the new feature file |

## Edge cases covered and where

| Case | Test |
|---|---|
| Raw retention of 3 runs does not cap the sample count | storage: "counts every tallied cycle…" |
| New instance has a smaller denominator, same formula | storage: "clipped to its first check…"; uptime: "same counts give the same percentage" |
| Rolling window excludes and prunes old data; reads never delete | storage: "window is rolling…" |
| Straddling bucket included whole (documented over-inclusion ≤ 1 h) | storage: "bucket straddling…"; uptime coverage 30.04 days |
| Monitor outage is a gap, not downtime | storage: "monitor downtime creates a gap…" |
| `null` checked_at is not tallied | storage: "cycles without a timestamp…" |
| Unknown excluded from numerator and denominator | storage: "platform uptime counts…", "only ever reported unknown"; feature "Unknown results…" |
| Platform good = any instance healthy; all-unknown cycle skipped | storage: "platform uptime counts…" |
| Offset timestamps normalized | storage: "timestamps with offsets…" |
| Out-of-order timestamps do not over-prune | storage: "out-of-order older timestamp…" |
| Rollback and stale revision leave buckets unchanged | storage: "failed and stale cycles…" |
| Cascade delete | storage: "deleting a platform cascades…" |
| Legacy import tallies only timed runs | storage: "legacy JSON import tallies…" |
| v1 → v2 migration with backfill; v3 fails closed | storage: "version 1 database upgrades…" |
| Invalid `now` rejected; `list` is pure | storage: "list(now) is read-only…" |
| Floor rounding, exact-target float safety, no 0/0 | uptime tests |
| Provisional thresholds at the exact boundaries | uptime: "thin data is provisional" |
| Clock skew (future first sample) yields coverage 1, not 0 | uptime: coverage test |
| Timeout counts as failure, injected clock places buckets | storage: "monitor's injected clock…" |
| API shape stable: fields absent until the first tallied cycle | api test |

## Risks and open points

- **Schema bump.** Existing deployments upgrade on first open inside the
  constructor transaction; a failure rolls back and the app refuses to start,
  consistent with the current fail-closed behavior. Backups taken before the
  upgrade open fine on the new code (they upgrade on open).
- **Only 3 runs can be backfilled.** Uptime history starts at deployment of
  this change. The UI's coverage label makes that visible rather than hiding it.
- **Hour granularity at the window edge.** Up to one extra hour of samples is
  counted. Acceptable for a 30-day figure (0.14% of the window) and documented.
- **Pruning keyed on the cycle timestamp.** A wall clock jumping more than 30
  days forward would prune real history. Jumps backward are harmless. This
  matches how `recordCycle` already trusts `checkedAt`.
- **Per-instance per-hour write.** One `UPSERT` per instance per cycle plus
  one per platform, inside the existing transaction. Negligible against the
  current per-instance `INSERT`.
