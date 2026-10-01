import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { After, Given, When, Then } from "@cucumber/cucumber";
import { PlatformStore } from "../../../app/lib/server/storage.ts";
import { Monitor, validatePlatform } from "../../../app/lib/server/monitor.ts";
import { relativeCheckTime } from "../../../app/lib/check-time.ts";
import { boxes, renderView } from "./instance-state-history.mjs";

const url = "https://example.com/";
const colors = { gray: "unknown", green: "healthy", amber: "warning", red: "critical" };
Given("a platform and instance saved in SQLite", function () {
  this.directory = mkdtempSync(path.join(process.cwd(), ".bdd-sqlite-"));
  this.store = new PlatformStore(this.directory);
  this.store.add([validatePlatform({ id: "durable", name: "Durable", instances: [url], healthUrls: { [url]: "/health" } })]);
  this.clock = Date.parse("2026-01-01T00:00:00.000Z");
});
After({ tags: "@sqlite" }, function () {
  this.store?.close();
  if (this.directory) rmSync(this.directory, { recursive: true, force: true });
});
async function check(world, result) {
  world.clock += 10_000;
  await new Monitor(world.store, async () => result, () => new Date(world.clock).toISOString()).tick();
}
When("a persisted health check reports {string}", async function (result) {
  assert.ok(["online", "offline"].includes(result));
  await check(this, result === "online");
});
Then("the persisted instance boxes are {string}", function (expected) {
  assert.deepEqual(boxes(this.store.list()[0]), expected.split(", ").map((c) => colors[c]));
});
Then("the persisted platform boxes are {string}", function (expected) {
  assert.deepEqual(boxes(this.store.list()[0], "platform"), expected.split(", ").map((c) => colors[c]));
});
When("the database connection is closed and reopened", function () {
  this.snapshot = this.store.list(); this.store.close(); this.store = new PlatformStore(this.directory);
});
Then("all saved entities, checks and transitions are unchanged", function () {
  assert.deepEqual(this.store.list(), this.snapshot);
});
When("three more successful checks complete", async function () {
  this.beforeRepeat = this.store.list()[0];
  for (let i = 0; i < 3; i++) await check(this, true);
});
Then("the latest check advances without moving the healthy transition time", function () {
  const p = this.store.list()[0];
  assert.notEqual(p.checkedAt, this.beforeRepeat.checkedAt);
  assert.deepEqual(p.stateHistory, this.beforeRepeat.stateHistory);
  assert.deepEqual(p.platformStateHistory, this.beforeRepeat.platformStateHistory);
  assert.equal(relativeCheckTime(p.stateHistory[url][0].timestamp, this.clock), "30 seconds ago");
});

Then("the persisted timestamps render relative labels and full timestamp tooltips", function () {
  const p = this.store.list()[0];
  const html = renderView(p, this.clock);
  const rendered = [...html.matchAll(/<time dateTime="([^"]+)" title="([^"]+)">([^<]+)<\/time>/g)];
  const histories = [...p.platformStateHistory, ...p.stateHistory[url]];
  assert.equal(rendered.length, histories.length);
  for (const [index, state] of histories.entries()) {
    assert.equal(rendered[index][1], state.timestamp);
    assert.equal(rendered[index][2], new Date(state.timestamp).toLocaleString(undefined, { timeZoneName: "short" }));
    assert.equal(rendered[index][3], relativeCheckTime(state.timestamp, this.clock));
  }
});
