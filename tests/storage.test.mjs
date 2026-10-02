import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { PlatformStore, dataDirectory } from "../app/lib/server/storage.ts";
import { Monitor, validatePlatform } from "../app/lib/server/monitor.ts";
import { dashboardStatus, platformStatus } from "../app/lib/status.ts";

const url = "https://example.com/";
const second = "https://other.example.com/";
const time = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
function platform(id = "p", instances = [url]) {
  return validatePlatform({ id, name: id, instances, healthUrls: { [url]: "/health" } });
}
function fixture(t, legacy) {
  const directory = mkdtempSync(path.join(process.cwd(), ".sqlite-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (legacy !== undefined) writeFileSync(path.join(directory, "platforms.json"), JSON.stringify(legacy));
  let store;
  t.after(() => store?.close());
  return {
    directory,
    open() { store = new PlatformStore(directory); return store; },
    reopen() { store.close(); store = new PlatformStore(directory); return store; },
    raw() { const db = new DatabaseSync(path.join(directory, "nighthawk.sqlite")); db.exec("PRAGMA foreign_keys = ON"); t.after(() => db.close()); return db; },
  };
}
function cycle(store, results, seconds = 10, id = "p") {
  return store.recordCycle(id, results, time(seconds), store.revision(id));
}

test("creation persists all entities with one unknown state; duplicate browser imports cannot overwrite history", (t) => {
  const f = fixture(t); let store = f.open();
  const input = platform(); store.add([input]);
  assert.deepEqual(store.list(), [input]);
  cycle(store, { [url]: true });
  const expected = store.list();
  store.add([platform(), { ...platform("other"), name: "p" }]);
  assert.deepEqual(store.list(), expected);
  store = f.reopen();
  assert.deepEqual(store.list(), expected);
  const db = f.raw();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instances").get().n, 1);
  assert.ok(db.prepare("SELECT id FROM instances").get().id);
});

test("instance and platform deletion are atomic and cascade through monitoring data", (t) => {
  const f = fixture(t); const store = f.open();
  store.add([platform("p", [url, second]), platform("other")]);
  cycle(store, { [url]: true, [second]: false });
  const revision = store.revision("p");
  assert.equal(store.deleteInstance("p", second), true);
  assert.equal(store.deleteInstance("p", second), false);
  assert.equal(store.revision("p"), revision + 1);
  assert.deepEqual(store.list().find((p) => p.id === "p").instances, [url]);
  const db = f.raw();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instances WHERE platform_id = 'p'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instance_state_changes WHERE instance_id NOT IN (SELECT id FROM instances)").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instance_check_buckets WHERE instance_id NOT IN (SELECT id FROM instances)").get().n, 0);
  assert.equal(store.deletePlatform("p"), true);
  assert.equal(store.deletePlatform("p"), false);
  assert.deepEqual(store.list().map((p) => p.id), ["other"]);
  for (const table of ["instances", "check_runs", "check_results", "platform_state_changes", "platform_check_buckets"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE platform_id = 'p'`).get().n, 0);
  }
});

test("history survives a separate process, deduplicates repeated results and keeps three aligned cycles", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  const initial = store.list()[0].createdAt;
  for (const [i, result] of [true, true, false, false, true, true].entries()) cycle(store, { [url]: result }, i * 10);
  const p = store.list()[0];
  assert.deepEqual(p.checks[url], [true, true, false]);
  assert.deepEqual(p.checkTimes, [time(50), time(40), time(30)]);
  assert.deepEqual(p.stateHistory[url], [
    { status: "healthy", timestamp: time(40) }, { status: "warning", timestamp: time(20) },
    { status: "healthy", timestamp: time(0) }, { status: "unknown", timestamp: initial },
  ]);
  assert.deepEqual(p.platformStateHistory.map((s) => s.status), ["healthy", "critical", "healthy", "unknown"]);
  assert.equal(dashboardStatus(p), "warning");
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    'import { PlatformStore } from "./app/lib/server/storage.ts"; const store = new PlatformStore(process.argv[1]); console.log(JSON.stringify(store.list())); store.close();', f.directory], { cwd: process.cwd(), encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [p]);
  const db = f.raw();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM check_runs").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM check_results").get().n, 3);
});

test("mixed results, empty platforms, unknowns and dashboard recovery retain aggregation semantics", (t) => {
  const empty = { id: "empty", name: "empty", instances: [] };
  const f = fixture(t, [empty]); const store = f.open(); store.add([platform("p", [url, second])]);
  const cases = [[true, false, "healthy"], [true, null, "healthy"], [false, null, "unknown"], [null, null, "unknown"], [false, false, "critical"], [true, false, "healthy"]];
  for (const [a, b, expected] of cases) {
    cycle(store, { [url]: a, [second]: b });
    const p = store.list().find((p) => p.id === "p");
    assert.equal(platformStatus(p), expected);
    assert.equal(p.platformStateHistory[0].status, expected);
    assert.equal(p.checks[url].length, p.checks[second].length);
  }
  assert.equal(dashboardStatus(store.list()[0]), "warning");
  for (let i = 0; i < 3; i++) cycle(store, { [url]: true, [second]: true });
  assert.equal(dashboardStatus(store.list()[0]), "healthy");
  cycle(store, {}, 10, "empty");
  const p = store.list().find((p) => p.id === "empty");
  assert.deepEqual(p.platformStateHistory, [{ status: "unknown", timestamp: null }]);
});

test("failed first checks and identical timestamps preserve transition order", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  for (const result of [false, true, false, true]) cycle(store, { [url]: result });
  const p = f.reopen().list()[0];
  assert.deepEqual(p.stateHistory[url].map((s) => s.status), ["healthy", "warning", "healthy", "warning", "unknown"]);
  assert.deepEqual(p.platformStateHistory.map((s) => s.status), ["healthy", "critical", "healthy", "critical", "unknown"]);
});

test("platform creation and batch imports roll back completely on a mid-write failure", (t) => {
  const f = fixture(t); const store = f.open(); const db = f.raw();
  db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON instances WHEN NEW.platform_id = 'bad' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  assert.throws(() => store.add([platform("good"), platform("bad")]), /injected failure/);
  assert.deepEqual(store.list(), []);
  for (const table of ["platforms", "instances", "instance_state_changes", "platform_state_changes"]) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  db.exec("DROP TRIGGER fail_insert"); store.add([platform()]);
  assert.equal(store.list().length, 1);
});

test("check cycles roll back results, transitions, revision and pruning; concurrent readers see committed state", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  for (let i = 0; i < 3; i++) cycle(store, { [url]: true }, i);
  const before = store.list(); const revision = store.revision("p"); const db = f.raw();
  db.exec("CREATE TRIGGER fail_cycle BEFORE UPDATE ON platforms BEGIN SELECT RAISE(ABORT, 'cycle failure'); END");
  assert.throws(() => cycle(store, { [url]: false }), /cycle failure/);
  assert.deepEqual(store.list(), before); assert.equal(store.revision("p"), revision);
  db.exec("DROP TRIGGER fail_cycle; BEGIN IMMEDIATE; UPDATE platforms SET name = 'uncommitted'");
  assert.deepEqual(store.list(), before);
  db.exec("ROLLBACK");
  cycle(store, { [url]: false }); assert.equal(store.list()[0].stateHistory[url][0].status, "warning");
});

test("stale cycles, retries, malformed results and missing platforms cannot change persisted state", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  assert.equal(store.recordCycle("p", { [url]: true }, time(10), 0), true);
  const before = store.list();
  assert.equal(store.recordCycle("p", { [url]: false }, time(0), 0), false);
  assert.equal(store.recordCycle("p", { [url]: true }, time(10), 0), false);
  for (const results of [{}, { [url]: "yes" }, { [url]: true, [second]: false }]) assert.throws(() => cycle(store, results), /exactly one/);
  assert.throws(() => store.recordCycle("p", { [url]: true }, "bad date", 1), /timestamp/);
  assert.throws(() => cycle(store, { [url]: true }, 10, "missing"), /does not exist/);
  assert.deepEqual(store.list(), before);
});

test("foreign keys reject missing parents and cross-platform check results", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform(), platform("other")]); const db = f.raw();
  assert.throws(() => db.prepare("INSERT INTO instances VALUES ('orphan', 'missing', ?, ?, NULL, 0)").run(url, url), /FOREIGN KEY/);
  cycle(store, { [url]: true });
  const run = db.prepare("SELECT id FROM check_runs").get().id;
  const other = db.prepare("SELECT id FROM instances WHERE platform_id = 'other'").get().id;
  assert.throws(() => db.prepare("INSERT INTO check_results VALUES ('p', ?, ?, 1)").run(run, other), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO check_results VALUES ('p', 9999, ?, 1)").run(other), /FOREIGN KEY/);
});

test("platform limit rejects an entire batch without acknowledging partial writes", (t) => {
  const f = fixture(t); const store = f.open(); store.add(Array.from({ length: 99 }, (_, i) => platform(String(i))));
  assert.throws(() => store.add([platform("100"), platform("101")]), /limit/);
  assert.equal(store.list().length, 99);
});

test("current JSON migration preserves every retained value, is one-time, and leaves the source intact", (t) => {
  const p = platform();
  p.checkedAt = time(20); p.checkTimes = [time(20), time(10), null]; p.checks = { [url]: [true, false, null] };
  p.stateHistory[url].unshift({ status: "healthy", timestamp: time(20) }, { status: "warning", timestamp: time(10) });
  p.platformStateHistory.unshift({ status: "healthy", timestamp: time(20) }, { status: "critical", timestamp: time(10) });
  const f = fixture(t, [p]); let store = f.open();
  assert.deepEqual(store.list(), [p]);
  assert.equal(readFileSync(path.join(f.directory, "platforms.json"), "utf8"), JSON.stringify([p]));
  cycle(store, { [url]: false }, 30); const expected = store.list();
  writeFileSync(path.join(f.directory, "platforms.json"), "invalid after migration");
  store = f.reopen(); assert.deepEqual(store.list(), expected);
  assert.equal(f.raw().prepare("PRAGMA user_version").get().user_version, 2);
});

test("older JSON reconstructs history, defaults endpoints and preserves missing timestamps and URL keys", (t) => {
  const oldUrl = "https://example.com";
  const p = { id: "p", name: "p", instances: [oldUrl], checkedAt: time(20), checks: { [oldUrl]: [true, false, false] } };
  const f = fixture(t, [p]); const store = f.open(); const migrated = store.list()[0];
  assert.deepEqual(migrated.instances, [oldUrl]);
  assert.equal(migrated.healthUrls[oldUrl], url);
  assert.deepEqual(migrated.checkTimes, [time(20), null, null]);
  assert.deepEqual(migrated.stateHistory[oldUrl], [{ status: "healthy", timestamp: time(20) }, { status: "warning", timestamp: null }, { status: "unknown", timestamp: null }]);
  assert.deepEqual(migrated.platformStateHistory.map((s) => s.status), ["healthy", "critical", "unknown"]);
  assert.deepEqual(f.reopen().list()[0], migrated);
});

test("invalid JSON imports roll back schema and data and can be retried after correction", (t) => {
  const cases = ["{broken", {}, [platform(), platform()], [platform(), { ...platform("other"), name: "p" }],
    [platform(), { ...platform("bad"), instances: ["file:///secret"] }],
    [{ ...platform(), checks: { [second]: [true] } }], [{ ...platform(), checks: { [url]: ["yes"] } }],
    [{ ...platform(), createdAt: "bad date" }], [{ ...platform(), stateHistory: { [url]: [{ status: "red", timestamp: null }] } }],
    [{ ...platform(), instances: [url, "https://example.com"] }]];
  for (const invalid of cases) {
    const f = fixture(t);
    writeFileSync(path.join(f.directory, "platforms.json"), typeof invalid === "string" ? invalid : JSON.stringify(invalid));
    assert.throws(() => new PlatformStore(f.directory));
    const db = f.raw();
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n, 0);
    writeFileSync(path.join(f.directory, "platforms.json"), JSON.stringify([platform()]));
    assert.equal(f.open().list().length, 1);
  }
});

test("interrupted import rolls back; existing schema upgrades reopen and future schemas fail closed", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  const expected = store.list(); const db = f.raw();
  db.exec("BEGIN IMMEDIATE; DELETE FROM metadata; DELETE FROM platforms; ROLLBACK");
  assert.deepEqual(f.reopen().list(), expected);
  db.exec("PRAGMA user_version = 3");
  assert.throws(() => new PlatformStore(f.directory), /Unsupported SQLite schema/);
  assert.deepEqual(f.raw().prepare("SELECT name FROM platforms").all().map((p) => p.name), ["p"]);
});

test("corrupt, unavailable and locked databases fail without resetting data", (t) => {
  const corrupt = fixture(t); const filename = path.join(corrupt.directory, "nighthawk.sqlite");
  writeFileSync(filename, "not a sqlite database");
  assert.throws(() => new PlatformStore(corrupt.directory));
  assert.equal(readFileSync(filename, "utf8"), "not a sqlite database");
  const readonly = fixture(t);
  chmodSync(readonly.directory, 0o500);
  try { assert.throws(() => new PlatformStore(readonly.directory), /unable to open|permission/i); }
  finally { chmodSync(readonly.directory, 0o700); }
  const blocked = fixture(t); const file = path.join(blocked.directory, "file"); writeFileSync(file, "occupied");
  assert.throws(() => new PlatformStore(file));
  const f = fixture(t); const store = f.open(); store.add([platform()]); const before = store.list(); const db = f.raw();
  db.exec("BEGIN IMMEDIATE");
  try { assert.throws(() => store.add([platform("locked")]), /locked/); }
  finally { db.exec("ROLLBACK"); }
  assert.deepEqual(store.list(), before);
});

test("configured/default paths and consistent WAL backup restored to a fresh directory", (t) => {
  const previous = process.env.NIGHTHAWK_DATA_DIR;
  t.after(() => { if (previous === undefined) delete process.env.NIGHTHAWK_DATA_DIR; else process.env.NIGHTHAWK_DATA_DIR = previous; });
  delete process.env.NIGHTHAWK_DATA_DIR;
  assert.equal(dataDirectory(), path.join(process.cwd(), "data"));
  const f = fixture(t); process.env.NIGHTHAWK_DATA_DIR = f.directory;
  assert.equal(dataDirectory(), f.directory);
  const store = f.open(); store.add([platform()]); cycle(store, { [url]: true });
  const destination = path.join(f.directory, "backup.sqlite");
  execFileSync(process.execPath, ["scripts/backup.mjs", destination], { cwd: process.cwd(), env: { ...process.env, NIGHTHAWK_DATA_DIR: f.directory } });
  assert.throws(() => store.backup(destination));
  const restored = path.join(f.directory, "restored"); mkdirSync(restored);
  copyFileSync(destination, path.join(restored, "nighthawk.sqlite"));
  const backup = new PlatformStore(restored); t.after(() => backup.close());
  assert.deepEqual(backup.list(), store.list());
  cycle(store, { [url]: false }); assert.equal(backup.list()[0].checks[url][0], true);
});

test("monitor prevents overlapping ticks, persists failures and recovers after failed writes", async (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  let resolve; let calls = 0;
  const monitor = new Monitor(store, () => { calls++; return new Promise((r) => { resolve = r; }); }, () => time(10));
  const first = monitor.tick(); await monitor.tick();
  assert.equal(calls, 1); assert.equal(store.revision("p"), 0);
  resolve(true); await first; assert.equal(store.revision("p"), 1);
  const failure = new Monitor(store, async () => { throw new Error("DNS/TLS failure"); }, () => time(20));
  await failure.tick(); assert.deepEqual(store.list()[0].checks[url], [false, true]);
  const db = f.raw(); const before = store.list();
  db.exec("CREATE TRIGGER fail_monitor BEFORE INSERT ON check_runs BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await assert.rejects(failure.tick(), /Unable to persist/); assert.deepEqual(store.list(), before);
  db.exec("DROP TRIGGER fail_monitor"); await failure.tick(); assert.equal(store.revision("p"), 3);
});

test("monitor timeouts persist failed checks and abort pending requests", async (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]); let signal;
  const monitor = new Monitor(store, (_url, s) => { signal = s; return new Promise(() => {}); }, () => time(10), 5);
  await monitor.tick(); assert.equal(signal.aborted, true);
  assert.deepEqual(store.list()[0].checks[url], [false]);
  assert.deepEqual(store.list()[0].stateHistory[url].map((s) => s.status), ["warning", "unknown"]);
});


test("process termination during a transaction rolls back on reopen", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]); cycle(store, { [url]: true });
  const before = store.list();
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("BEGIN IMMEDIATE; DELETE FROM metadata; UPDATE platforms SET name = 'interrupted'");
    process.kill(process.pid, "SIGKILL");
  `, store.filename], { stdio: "pipe" }), (error) => error.signal === "SIGKILL");
  assert.deepEqual(f.reopen().list(), before);
});

test("an empty legacy dataset imports once and unmatched cycle lengths retain alignment", (t) => {
  const empty = fixture(t, []); assert.deepEqual(empty.open().list(), []);
  assert.equal(empty.raw().prepare("SELECT value FROM metadata WHERE key = 'json_import'").get().value, "complete");
  const f = fixture(t, [{ id: "p", name: "p", instances: [url, second], checks: { [url]: [true, false, true], [second]: [false] } }]);
  const p = f.open().list()[0];
  assert.deepEqual(p.checks, { [url]: [true, false, true], [second]: [false, null, null] });
  assert.deepEqual(p.checkTimes, [null, null, null]);
  assert.equal(dashboardStatus(p), "healthy");
});

test("the scheduler runs immediately, repeats every ten seconds and stops", async (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  let checks = 0;
  const monitor = new Monitor(store, async () => { checks++; return true; }, () => time(checks * 10));
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => monitor.stop());
  async function settle() { await new Promise((resolve) => setImmediate(resolve)); }
  monitor.start(); await settle(); assert.equal(checks, 1);
  monitor.start(); t.mock.timers.tick(9_999); await settle(); assert.equal(checks, 1);
  t.mock.timers.tick(1); await settle(); assert.equal(checks, 2);
  monitor.stop(); t.mock.timers.tick(10_000); await settle(); assert.equal(checks, 2);
});

const dayAt = (days, seconds = 0) => new Date(Date.UTC(2026, 0, 1 + days, 0, 0, seconds)).toISOString();
const cycleAt = (store, results, at, id = "p") => store.recordCycle(id, results, at, store.revision(id));
const bucketRows = (db, table = "instance_check_buckets") => db.prepare(`SELECT * FROM ${table} ORDER BY bucket`).all();

test("uptime survives three-run retention, excludes unknown, and persists", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  assert.equal(store.list(dayAt(0))[0].uptime, undefined);
  [true, true, false, true, true, true, null, true, false, true].forEach((r, i) => cycle(store, { [url]: r }, i * 10));
  const p = store.list(dayAt(1))[0]; const db = f.raw();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM check_runs").get().n, 3);
  assert.deepEqual(p.uptime[url], { good: 7, samples: 9, firstSampleAt: time(0), lastSampleAt: time(90) });
  assert.deepEqual(p.platformUptime, p.uptime[url]);
  assert.equal(bucketRows(db).length, 1);
  assert.deepEqual(f.reopen().list(dayAt(1)), [p]);
});

test("new instances use only their actual checks, with no padding", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("old")]);
  for (let d = 0; d < 20; d++) cycleAt(store, { [url]: d !== 10 }, dayAt(d), "old");
  store.add([platform("new")]);
  for (let d = 17; d < 20; d++) cycleAt(store, { [url]: d !== 18 }, dayAt(d), "new");
  assert.deepEqual(store.list(dayAt(20)).find((p) => p.id === "old").uptime[url], { good: 19, samples: 20, firstSampleAt: dayAt(0), lastSampleAt: dayAt(19) });
  assert.deepEqual(store.list(dayAt(20)).find((p) => p.id === "new").uptime[url], { good: 2, samples: 3, firstSampleAt: dayAt(17), lastSampleAt: dayAt(19) });
  assert.equal(f.raw().prepare("SELECT COUNT(*) AS n FROM instance_check_buckets WHERE total = 0").get().n, 0);
});

test("rolling reads exclude old buckets and writes prune them", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: false }, dayAt(0));
  cycleAt(store, { [url]: true }, dayAt(29, 86399));
  assert.equal(store.list(dayAt(30))[0].uptime[url].samples, 2);
  assert.deepEqual(store.list(dayAt(31))[0].uptime[url], { good: 1, samples: 1, firstSampleAt: dayAt(29, 86399), lastSampleAt: dayAt(29, 86399) });
  const db = f.raw(); assert.equal(bucketRows(db).length, 2);
  cycleAt(store, { [url]: true }, dayAt(31));
  assert.equal(bucketRows(db).length, 2);
  assert.equal(bucketRows(db, "platform_check_buckets").length, 2);
});

test("a straddling hour is included whole until its last check exits the window", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: false }, dayAt(0)); cycleAt(store, { [url]: true }, dayAt(0, 3000));
  assert.deepEqual(store.list(dayAt(30, 1500))[0].uptime[url], { good: 1, samples: 2, firstSampleAt: dayAt(0), lastSampleAt: dayAt(0, 3000) });
  assert.equal(store.list(dayAt(30, 3001))[0].uptime, undefined);
});

test("gaps and untimed or unknown results do not invent downtime", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("p", [url, second])]);
  cycleAt(store, { [url]: true, [second]: null }, dayAt(0));
  cycleAt(store, { [url]: true, [second]: null }, dayAt(5));
  cycleAt(store, { [url]: true, [second]: true }, null);
  const p = store.list(dayAt(6))[0];
  assert.deepEqual(p.uptime[url], { good: 2, samples: 2, firstSampleAt: dayAt(0), lastSampleAt: dayAt(5) });
  assert.equal(p.uptime[second], undefined);
  assert.equal(bucketRows(f.raw()).length, 2);
  assert.equal(p.checkTimes[0], null);
});

test("platform uptime uses any healthy instance and skips all unknown cycles", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform("p", [url, second])]);
  [[true, false], [true, null], [false, null], [null, null], [false, false], [true, true]].forEach(([a, b], i) => cycle(store, { [url]: a, [second]: b }, i * 10));
  const p = store.list(dayAt(1))[0];
  assert.deepEqual(p.platformUptime, { good: 3, samples: 5, firstSampleAt: time(0), lastSampleAt: time(50) });
  assert.deepEqual(p.uptime[second], { good: 1, samples: 3, firstSampleAt: time(0), lastSampleAt: time(50) });
});

test("offsets normalize, out-of-order checks aggregate, and deleted platforms cascade", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycleAt(store, { [url]: true }, "2026-01-01T02:00:00+02:00");
  cycleAt(store, { [url]: false }, "2026-01-01T00:30:00.000Z");
  cycleAt(store, { [url]: true }, dayAt(1));
  assert.deepEqual(store.list(dayAt(2))[0].uptime[url], { good: 2, samples: 3, firstSampleAt: dayAt(0), lastSampleAt: dayAt(1) });
  const db = f.raw(); assert.equal(bucketRows(db).length, 2);
  db.prepare("DELETE FROM platforms WHERE id = 'p'").run();
  assert.equal(bucketRows(db).length, 0); assert.equal(bucketRows(db, "platform_check_buckets").length, 0);
});

test("v1 migration backfills only retained runs and rejects future schema", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  [true, false, true, true].forEach((r, i) => cycle(store, { [url]: r }, i * 10));
  const db = f.raw();
  db.exec("DROP TABLE instance_check_buckets; DROP TABLE platform_check_buckets; PRAGMA user_version = 1");
  const upgraded = f.reopen();
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  assert.deepEqual(upgraded.list(dayAt(1))[0].uptime[url], { good: 2, samples: 3, firstSampleAt: time(10), lastSampleAt: time(30) });
  db.exec("PRAGMA user_version = 3");
  assert.throws(() => new PlatformStore(f.directory), /Unsupported SQLite schema/);
});

test("stale and failed cycles never change rollups; invalid read clocks fail", (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  cycle(store, { [url]: true }, 0); const db = f.raw(); const before = bucketRows(db);
  db.exec("CREATE TRIGGER fail_cycle BEFORE UPDATE ON platforms BEGIN SELECT RAISE(ABORT, 'cycle failure'); END");
  assert.throws(() => cycle(store, { [url]: false }, 10), /cycle failure/);
  db.exec("DROP TRIGGER fail_cycle");
  assert.equal(store.recordCycle("p", { [url]: false }, time(20), 0), false);
  assert.deepEqual(bucketRows(db), before);
  assert.throws(() => store.list("not a date"), /timestamp/);
});

test("legacy import tallies only timed known results", (t) => {
  const p = platform();
  p.checkedAt = time(20); p.checkTimes = [time(20), time(10), null]; p.checks = { [url]: [true, false, null] };
  const f = fixture(t, [p]); const store = f.open();
  assert.deepEqual(store.list(dayAt(1))[0].uptime[url], { good: 1, samples: 2, firstSampleAt: time(10), lastSampleAt: time(20) });
  const untimed = fixture(t, [{ id: "u", name: "u", instances: [url], checks: { [url]: [true, true, true] } }]);
  assert.equal(untimed.open().list(dayAt(1))[0].uptime, undefined);
});

test("the injected monitor clock places hourly buckets and a timeout adds a failed sample", async (t) => {
  const f = fixture(t); const store = f.open(); store.add([platform()]);
  let n = 0;
  const monitor = new Monitor(store, async () => n % 2 === 0, () => dayAt(0, n++ * 3600));
  for (let i = 0; i < 4; i++) await monitor.tick();
  assert.equal(bucketRows(f.raw()).length, 4);
  assert.deepEqual(store.list(dayAt(1))[0].uptime[url], { good: 2, samples: 4, firstSampleAt: dayAt(0), lastSampleAt: dayAt(0, 10800) });
  const slow = new Monitor(store, () => new Promise(() => {}), () => dayAt(0, 14400), 5);
  await slow.tick();
  assert.equal(store.list(dayAt(1))[0].uptime[url].samples, 5);
  assert.equal(store.list(dayAt(1))[0].uptime[url].good, 2);
});
