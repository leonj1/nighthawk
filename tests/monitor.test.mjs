import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { healthUrl } from "../app/lib/health-url.ts";
import { probe, publicAddress } from "../app/lib/server/probe.ts";

test("health endpoints support paths, full URLs and existing instance URLs", () => {
  assert.equal(healthUrl("https://example.com/app", "/health"), "https://example.com/health");
  assert.equal(healthUrl("example.com", "https://status.example.com/ready?deep=1"), "https://status.example.com/ready?deep=1");
  assert.equal(healthUrl("https://example.com/app"), "https://example.com/app");
  assert.throws(() => healthUrl("https://example.com", "file:///secret"));
  assert.throws(() => healthUrl("https://user:password@example.com"));
});

test("probes refuse private and metadata addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1"]) {
    assert.equal(publicAddress(address), false);
  }
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(await probe("http://127.0.0.1/health", AbortSignal.timeout(1000)), false);
});

test("monitor imports instances, rejects invalid input, persists checks and bounds history", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".monitor-test-"));
  process.env.NIGHTHAWK_DATA_DIR = directory;
  const { addPlatforms, getPlatforms, tick, validatePlatform } = await import("../app/lib/server/monitor.ts");
  try {
    assert.throws(() => validatePlatform({ id: "x", name: "x", instances: ["ftp://example.com"] }));
    assert.throws(() => validatePlatform({ id: "x", name: "x", instances: ["https://example.com", "https://example.com/"] }));
    const input = { id: "test", name: "test", instances: ["http://127.0.0.1"], healthUrls: { "http://127.0.0.1": "/health" }, checks: { "http://127.0.0.1": [true] } };
    await addPlatforms([input]);
    await addPlatforms([input]);
    // Allow the startup tick to finish before triggering deterministic cycles.
    while (globalThis.nighthawkMonitor.running) await new Promise((resolve) => setTimeout(resolve, 5));
    const legacy = (await getPlatforms())[0];
    legacy.checkedAt = "2026-01-01T00:00:00.000Z";
    delete legacy.checkTimes;
    await tick();
    assert.deepEqual(legacy.checkTimes, [legacy.checkedAt, "2026-01-01T00:00:00.000Z"]);
    const previousTime = legacy.checkedAt;
    await tick();
    assert.deepEqual(legacy.checkTimes, [legacy.checkedAt, previousTime, "2026-01-01T00:00:00.000Z"]);
    for (let i = 0; i < 4; i++) await tick();
    const platforms = await getPlatforms();
    assert.equal(platforms.length, 1);
    assert.equal(platforms[0].healthUrls["http://127.0.0.1/"], "http://127.0.0.1/health");
    assert.deepEqual(platforms[0].checks["http://127.0.0.1/"], [false, false, false]);
    assert.deepEqual(platforms[0].platformStateHistory.map(({ status }) => status), ["critical", "unknown"]);
    assert.equal(platforms[0].platformStateHistory[1].timestamp, platforms[0].createdAt);
    assert.ok(platforms[0].platformStateHistory.every(({ timestamp }) => Number.isFinite(Date.parse(timestamp))));
    assert.ok(platforms[0].checkedAt);
    assert.equal(platforms[0].checkTimes.length, 3);
    assert.equal(platforms[0].checkTimes[0], platforms[0].checkedAt);
    assert.ok(platforms[0].checkTimes.every((timestamp) => Number.isFinite(Date.parse(timestamp))));
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "platforms.json"), "utf8")), platforms);
  } finally {
    clearInterval(globalThis.nighthawkMonitor.timer);
    await rm(directory, { recursive: true, force: true });
  }
});

test("probes classify responses, follow redirects and propagate connection errors", async (t) => {
  let status = 200;
  let location;
  let calls = 0;
  let connectionError = false;
  t.mock.method(http, "get", (url, options, callback) => {
    calls++;
    assert.equal(options.family, 4);
    options.lookup(url.hostname, {}, (error, address) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
    });
    const request = new EventEmitter();
    queueMicrotask(() => {
      if (connectionError) request.emit("error", new Error("Connection refused"));
      else callback({ statusCode: status, headers: { location }, destroy() {} });
    });
    return request;
  });
  const signal = AbortSignal.timeout(1000);
  assert.equal(await probe("http://8.8.8.8/health", signal), true);
  status = 503;
  assert.equal(await probe("http://8.8.8.8/health", signal), false);
  status = 302;
  location = "http://127.0.0.1/private";
  assert.equal(await probe("http://8.8.8.8/health", signal), false);
  location = "/loop";
  calls = 0;
  assert.equal(await probe("http://8.8.8.8/health", signal), false);
  assert.equal(calls, 4);
  connectionError = true;
  await assert.rejects(probe("http://8.8.8.8/health", signal), /Connection refused/);
});
