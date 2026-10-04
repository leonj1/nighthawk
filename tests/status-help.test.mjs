import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const help = readFileSync(new URL("../app/dashboard/status-help.tsx", import.meta.url), "utf8");

test("dashboard renders the legend and info icon instead of the explanatory paragraphs", () => {
  assert.match(dashboard, /<StatusLegend \/>\s*<StatusInfo \/>\s*<\/div>/);
  assert.doesNotMatch(dashboard, /status-note/);
  assert.doesNotMatch(dashboard, /Health checks run every 10 seconds/);
});

test("legend shows a swatch for each status in severity order", () => {
  const entries = [...help.matchAll(/\{ status: "(\w+)", label: "(\w+)" \}/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(entries, ["healthy:Healthy", "warning:Recovered", "critical:Down", "unknown:Unchecked"]);
  assert.match(help, /className=\{`status-swatch platform-tile--\$\{item\.status\}`\}/);
});

test("info popover carries the check interval and uptime definitions", () => {
  assert.match(help, /aria-expanded=\{open\}/);
  assert.match(help, /Health checks run every 10 seconds\. HTTP 2xx responses are healthy\./);
  assert.match(help, /Uptime is the share of checks that succeeded in the last 30 days\. Unknown results are not counted\./);
  assert.match(help, /event\.key === "Escape"/);
});
