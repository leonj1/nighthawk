import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const instances = readFileSync(new URL("../app/instances/instances-view.tsx", import.meta.url), "utf8");

test("platform cards do not expose delete controls", () => {
  assert.doesNotMatch(dashboard, /Delete platform/);
  assert.doesNotMatch(dashboard, /delete-platform-button/);
});

test("instances page confirms before deleting a platform", () => {
  assert.match(instances, /window\.confirm\(`Delete \$\{platform\.name\} and all of its instances\? This cannot be undone\.`\)/);
  assert.match(instances, /\{deletingPlatform \? "Deleting…" : "Delete platform"\}/);
  assert.match(instances, /await deletePlatform\(platform\.id\)/);
  assert.match(instances, /router\.push\("\/dashboard"\)/);
});
