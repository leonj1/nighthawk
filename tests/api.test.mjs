import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Monitor } from "../app/lib/server/monitor.ts";
import { PlatformStore } from "../app/lib/server/storage.ts";
import { GET, POST } from "../app/api/platforms/route.ts";

test("API creates, imports and lists durable entities with the existing response shape; unsaved writes fail", async () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".api-test-"));
  const previous = process.env.NIGHTHAWK_DATA_DIR;
  process.env.NIGHTHAWK_DATA_DIR = directory;
  globalThis.nighthawkMonitor = new Monitor(new PlatformStore(directory), async () => false);
  globalThis.nighthawkMonitor.start = () => {};
  const request = (inputs) => new Request("http://localhost/api/platforms", { method: "POST", body: JSON.stringify(inputs) });
  let db;
  try {
    const input = { id: "api", name: "API", instances: ["https://example.com"], healthUrls: { "https://example.com": "/health" } };
    const response = await POST(request([input]));
    assert.equal(response.status, 200);
    globalThis.nighthawkMonitor.stop();
    const saved = await response.json();
    assert.equal(saved[0].healthUrls["https://example.com/"], "https://example.com/health");
    assert.deepEqual(saved[0].stateHistory["https://example.com/"].map((s) => s.status), ["unknown"]);
    const result = await GET(); globalThis.nighthawkMonitor.stop();
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await result.json(), saved);
    assert.equal((await POST(request([{ ...input, instances: ["file:///bad"] }]))).status, 400);
    const duplicate = await POST(request([input])); globalThis.nighthawkMonitor.stop();
    assert.equal((await duplicate.json()).length, 1);
    db = new DatabaseSync(path.join(directory, "nighthawk.sqlite"));
    db.exec("CREATE TRIGGER fail_api BEFORE INSERT ON platforms BEGIN SELECT RAISE(ABORT, 'write rejected'); END");
    const failed = await POST(request([{ ...input, id: "new", name: "New" }]));
    assert.equal(failed.status, 400);
    assert.match((await failed.json()).error, /write rejected/);
    assert.equal(globalThis.nighthawkMonitor.store.list().length, 1);
  } finally {
    globalThis.nighthawkMonitor.stop();
    // The test installs a no-op scheduler below; there are no in-flight probes.
    globalThis.nighthawkMonitor.store.close(); delete globalThis.nighthawkMonitor;
    db?.close();
    if (previous === undefined) delete process.env.NIGHTHAWK_DATA_DIR; else process.env.NIGHTHAWK_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
