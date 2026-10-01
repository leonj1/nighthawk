import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { dataDirectory } from "../scripts/data-directory.mjs";

test("local storage keeps its default and explicit directory", () => {
  assert.equal(dataDirectory({}, process.cwd()), path.join(process.cwd(), "data"));
  assert.equal(dataDirectory({ NIGHTHAWK_DATA_DIR: "custom" }, process.cwd()), path.join(process.cwd(), "custom"));
});

test("Railway requires volume metadata and uses the mount by default", () => {
  for (const env of [{ RAILWAY_SERVICE_ID: "service" }, { RAILWAY_ENVIRONMENT_ID: "production" }]) {
    assert.throws(() => dataDirectory(env), /requires a Railway volume/);
    assert.throws(() => dataDirectory({ ...env, NIGHTHAWK_DATA_DIR: "/app/data" }), /requires a Railway volume/);
  }
  assert.equal(dataDirectory({ RAILWAY_VOLUME_MOUNT_PATH: "/persist" }), "/persist");
  assert.throws(() => dataDirectory({ RAILWAY_VOLUME_MOUNT_PATH: "relative" }), /requires a Railway volume/);
});

test("Railway permits the mount and descendants but rejects sibling and traversal paths", () => {
  const env = { RAILWAY_VOLUME_MOUNT_PATH: "/app/data" };
  for (const directory of ["/app/data", "/app/data/sqlite"]) {
    assert.equal(dataDirectory({ ...env, NIGHTHAWK_DATA_DIR: directory }), directory);
  }
  for (const directory of ["/app/other", "/app/data-other", "/app/data/../ephemeral"]) {
    assert.throws(() => dataDirectory({ ...env, NIGHTHAWK_DATA_DIR: directory }), /outside the Railway volume/);
  }
});

test("server and backup refuse missing volumes before creating a database", (t) => {
  const directory = mkdtempSync(path.join(process.cwd(), ".storage-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NIGHTHAWK_DATA_DIR: directory, RAILWAY_SERVICE_ID: "test", RAILWAY_VOLUME_MOUNT_PATH: "" };
  for (const args of [
    ["--experimental-strip-types", "--input-type=module", "-e", "import { PlatformStore } from './app/lib/server/storage.ts'; new PlatformStore();"],
    ["scripts/backup.mjs", path.join(directory, "backup.sqlite")],
  ]) {
    const result = spawnSync(process.execPath, args, { env, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /requires a Railway volume/);
    assert.equal(existsSync(path.join(directory, "nighthawk.sqlite")), false);
    assert.equal(existsSync(path.join(directory, "backup.sqlite")), false);
  }
});
