import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Platform, InstanceState, PlatformState } from "../status.ts";
import { instanceStateHistory, platformStateHistory, platformStatus } from "../status.ts";
import { healthUrl } from "../health-url.ts";

export function dataDirectory() {
  return process.env.NIGHTHAWK_DATA_DIR || path.join(process.cwd(), "data");
}

const schema = `
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE platforms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL
) STRICT;
CREATE TABLE instances (
  id TEXT PRIMARY KEY, platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  url TEXT NOT NULL, health_url TEXT NOT NULL, created_at TEXT, position INTEGER NOT NULL,
  UNIQUE(platform_id, url), UNIQUE(platform_id, id)
) STRICT;
CREATE TABLE check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  checked_at TEXT, UNIQUE(platform_id, id)
) STRICT;
CREATE TABLE check_results (
  platform_id TEXT NOT NULL, run_id INTEGER NOT NULL, instance_id TEXT NOT NULL,
  healthy INTEGER CHECK(healthy IN (0, 1)), PRIMARY KEY(run_id, instance_id),
  FOREIGN KEY(platform_id, run_id) REFERENCES check_runs(platform_id, id) ON DELETE CASCADE,
  FOREIGN KEY(platform_id, instance_id) REFERENCES instances(platform_id, id) ON DELETE CASCADE
) STRICT;
CREATE TABLE instance_state_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('unknown', 'healthy', 'warning')), timestamp TEXT
) STRICT;
CREATE TABLE platform_state_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('unknown', 'healthy', 'critical')), timestamp TEXT
) STRICT;
CREATE INDEX runs_platform ON check_runs(platform_id, id);
CREATE INDEX instance_history ON instance_state_changes(instance_id, id);
CREATE INDEX platform_history ON platform_state_changes(platform_id, id);
`;

function validTimestamp(value: unknown) {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

// Legacy disk data is trusted only after validating the entire import. Preserve
// original URL keys and missing timestamps; normalization would lose references.
function validateLegacy(value: unknown): Platform[] {
  if (!Array.isArray(value)) throw new Error("Legacy platforms.json must contain an array.");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const p of value) {
    if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name.trim() ||
        !Array.isArray(p.instances) || ids.has(p.id) || names.has(p.name)) throw new Error("Invalid or duplicate legacy platform.");
    ids.add(p.id); names.add(p.name);
    const urls = new Set<string>();
    for (const url of p.instances) {
      if (typeof url !== "string") throw new Error("Invalid legacy instance.");
      const normalized = healthUrl(url);
      if (urls.has(normalized)) throw new Error("Duplicate legacy instance.");
      urls.add(normalized);
    }
    for (const map of [p.healthUrls, p.checks, p.stateHistory]) {
      if (map !== undefined && (!map || typeof map !== "object" || Array.isArray(map) ||
          Object.keys(map).some((url) => !p.instances.includes(url)))) throw new Error("Invalid legacy instance reference.");
    }
    for (const url of p.instances) {
      if (p.healthUrls?.[url] !== undefined && typeof p.healthUrls[url] !== "string") throw new Error("Invalid legacy health URL.");
      healthUrl(url, p.healthUrls?.[url]);
      const checks = p.checks?.[url];
      if (checks !== undefined && (!Array.isArray(checks) || checks.some((c: unknown) => c !== null && typeof c !== "boolean"))) throw new Error("Invalid legacy check.");
    }
    for (const time of [p.createdAt, p.checkedAt]) {
      if (time !== undefined && !validTimestamp(time)) throw new Error("Invalid legacy timestamp.");
    }
    if (p.checkTimes !== undefined && (!Array.isArray(p.checkTimes) || !p.checkTimes.every(validTimestamp))) throw new Error("Invalid legacy check times.");
    const histories: [unknown, string[]][] = [[p.platformStateHistory, ["unknown", "healthy", "critical"]],
      ...p.instances.map((url: string): [unknown, string[]] => [p.stateHistory?.[url], ["unknown", "healthy", "warning"]])];
    for (const [history, statuses] of histories) {
      if (history !== undefined && (!Array.isArray(history) || history.some((s) => !s || !statuses.includes(s.status) || !validTimestamp(s.timestamp)))) throw new Error("Invalid legacy transition history.");
    }
  }
  return value;
}

export class PlatformStore {
  private db: DatabaseSync;
  readonly filename: string;

  constructor(directory = dataDirectory()) {
    this.filename = path.join(directory, "nighthawk.sqlite");
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(this.filename);
    try {
      this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      this.transaction(() => {
        const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
        if (version > 1) throw new Error(`Unsupported SQLite schema version ${version}.`);
        if (version === 0) { this.db.exec(schema); this.db.exec("PRAGMA user_version = 1"); }
        if (!this.db.prepare("SELECT 1 FROM metadata WHERE key = 'json_import'").get()) {
          let legacy: unknown = [];
          try { legacy = JSON.parse(readFileSync(path.join(directory, "platforms.json"), "utf8")); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const platforms = validateLegacy(legacy);
          for (let i = 0; i < platforms.length; i++) this.insert(platforms[i], -i);
          this.db.prepare("INSERT INTO metadata VALUES ('json_import', 'complete')").run();
        }
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(work: () => T, write = true): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close() { this.db.close(); }

  private insert(p: Platform, position: number) {
    this.db.prepare("INSERT INTO platforms(id, name, created_at, position) VALUES (?, ?, ?, ?)").run(p.id, p.name, p.createdAt ?? null, position);
    const instanceIds = new Map<string, string>();
    p.instances.forEach((url, index) => {
      const id = randomUUID(); instanceIds.set(url, id);
      this.db.prepare("INSERT INTO instances VALUES (?, ?, ?, ?, ?, ?)").run(id, p.id, url, healthUrl(url, p.healthUrls?.[url]), p.createdAt ?? null, index);
      for (const s of [...instanceStateHistory(p, url)].reverse()) {
        this.db.prepare("INSERT INTO instance_state_changes(instance_id, status, timestamp) VALUES (?, ?, ?)").run(id, s.status, s.timestamp);
      }
    });
    for (const s of [...platformStateHistory(p)].reverse()) {
      this.db.prepare("INSERT INTO platform_state_changes(platform_id, status, timestamp) VALUES (?, ?, ?)").run(p.id, s.status, s.timestamp);
    }
    const count = Math.min(3, Math.max(p.checkTimes?.length ?? 0, p.checkedAt ? 1 : 0, ...p.instances.map((url) => p.checks?.[url]?.length ?? 0)));
    for (let index = count - 1; index >= 0; index--) {
      const run = this.db.prepare("INSERT INTO check_runs(platform_id, checked_at) VALUES (?, ?)").run(p.id, p.checkTimes?.[index] ?? (index === 0 ? p.checkedAt ?? null : null)).lastInsertRowid;
      for (const [url, id] of instanceIds) {
        const result = p.checks?.[url]?.[index];
        this.db.prepare("INSERT INTO check_results VALUES (?, ?, ?, ?)").run(p.id, run, id, result == null ? null : Number(result));
      }
    }
  }

  list(): Platform[] {
    return this.transaction(() => this.db.prepare("SELECT * FROM platforms ORDER BY position DESC").all().map((row) => {
      const id = String(row.id);
      const instances = this.db.prepare("SELECT * FROM instances WHERE platform_id = ? ORDER BY position").all(id);
      const runs = this.db.prepare("SELECT * FROM check_runs WHERE platform_id = ? ORDER BY id DESC").all(id);
      const p: Platform = {
        id, name: String(row.name), instances: instances.map((i) => String(i.url)),
        ...(row.created_at === null ? {} : { createdAt: String(row.created_at) }),
        healthUrls: Object.fromEntries(instances.map((i) => [i.url, i.health_url])),
        stateHistory: Object.fromEntries(instances.map((i) => [i.url,
          this.db.prepare("SELECT status, timestamp FROM instance_state_changes WHERE instance_id = ? ORDER BY id DESC").all(i.id).map((s) => ({ ...s })) as InstanceState[]])),
        platformStateHistory: this.db.prepare("SELECT status, timestamp FROM platform_state_changes WHERE platform_id = ? ORDER BY id DESC").all(id).map((s) => ({ ...s })) as PlatformState[],
      };
      if (runs.length) {
        p.checkTimes = runs.map((r) => r.checked_at as string | null);
        if (p.checkTimes[0] !== null) p.checkedAt = p.checkTimes[0];
        p.checks = Object.fromEntries(instances.map((i) => [i.url, runs.map((r) => {
          const result = this.db.prepare("SELECT healthy FROM check_results WHERE run_id = ? AND instance_id = ?").get(r.id, i.id)!.healthy;
          return result === null ? null : result === 1;
        })]));
      }
      return p;
    }), false);
  }

  add(platforms: Platform[]) {
    this.transaction(() => {
      for (const p of platforms) {
        if (this.db.prepare("SELECT 1 FROM platforms WHERE id = ? OR name = ?").get(p.id, p.name)) continue;
        if (Number(this.db.prepare("SELECT COUNT(*) AS count FROM platforms").get()!.count) >= 100) throw new Error("The limit is 100 platforms.");
        const position = Number(this.db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS position FROM platforms").get()!.position);
        this.insert(p, position);
      }
    });
  }

  revision(platformId: string): number {
    const row = this.db.prepare("SELECT revision FROM platforms WHERE id = ?").get(platformId);
    if (!row) throw new Error("Platform does not exist.");
    return Number(row.revision);
  }

  // The expected revision makes retries and stale/overlapping cycles harmless.
  // Network requests must complete before entering this transaction.
  recordCycle(platformId: string, results: Record<string, boolean | null>, checkedAt: string, expectedRevision: number): boolean {
    if (!validTimestamp(checkedAt)) throw new Error("Invalid check timestamp.");
    return this.transaction(() => {
      if (this.revision(platformId) !== expectedRevision) return false;
      const instances = this.db.prepare("SELECT id, url FROM instances WHERE platform_id = ? ORDER BY position").all(platformId);
      if (Object.keys(results).length !== instances.length || instances.some((i) => !Object.hasOwn(results, String(i.url)) || (results[String(i.url)] !== null && typeof results[String(i.url)] !== "boolean"))) throw new Error("A cycle must contain exactly one result per instance.");
      const run = this.db.prepare("INSERT INTO check_runs(platform_id, checked_at) VALUES (?, ?)").run(platformId, checkedAt).lastInsertRowid;
      for (const i of instances) {
        const result = results[String(i.url)];
        this.db.prepare("INSERT INTO check_results VALUES (?, ?, ?, ?)").run(platformId, run, i.id, result === null ? null : Number(result));
        const status = result === null ? "unknown" : result ? "healthy" : "warning";
        const previous = this.db.prepare("SELECT status FROM instance_state_changes WHERE instance_id = ? ORDER BY id DESC LIMIT 1").get(i.id);
        if (previous?.status !== status) this.db.prepare("INSERT INTO instance_state_changes(instance_id, status, timestamp) VALUES (?, ?, ?)").run(i.id, status, checkedAt);
      }
      const p: Platform = { id: platformId, name: "", instances: instances.map((i) => String(i.url)), checks: Object.fromEntries(Object.entries(results).map(([url, value]) => [url, [value]])) };
      const status = platformStatus(p);
      const previous = this.db.prepare("SELECT status FROM platform_state_changes WHERE platform_id = ? ORDER BY id DESC LIMIT 1").get(platformId);
      if (previous?.status !== status) this.db.prepare("INSERT INTO platform_state_changes(platform_id, status, timestamp) VALUES (?, ?, ?)").run(platformId, status, checkedAt);
      this.db.prepare("DELETE FROM check_runs WHERE platform_id = ? AND id NOT IN (SELECT id FROM check_runs WHERE platform_id = ? ORDER BY id DESC LIMIT 3)").run(platformId, platformId);
      this.db.prepare("UPDATE platforms SET revision = revision + 1 WHERE id = ?").run(platformId);
      return true;
    });
  }

  // VACUUM INTO takes a consistent snapshot, including committed WAL contents.
  backup(destination: string) { this.db.prepare("VACUUM INTO ?").run(destination); }
}
