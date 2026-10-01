import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { Given, Then } from "@cucumber/cucumber";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "next/dist/build/swc/index.js";
import * as status from "../../../app/lib/status.ts";
import * as uptime from "../../../app/lib/uptime.ts";
import * as health from "../../../app/lib/health-url.ts";
import { renderView } from "./instance-state-history.mjs";

const require = createRequire(import.meta.url);
const url = "https://example.com/";
const second = "https://other.example.com/";
const source = readFileSync(new URL("../../../app/dashboard/page.tsx", import.meta.url), "utf8");
const { code } = await transform(source, {
  filename: "page.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
function dashboard(platform, now) {
  const exports = {};
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return { ...React, useState: (initial) => [initial, () => {}] };
      if (name === "../lib/use-platforms") return { usePlatforms: () => ({ platforms: [platform] }) };
      if (name === "../lib/status") return status;
      if (name === "../lib/uptime") return uptime;
      if (name === "../lib/health-url") return health;
      if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
      return require(name);
    },
    Date: class extends Date { static now() { return now; } },
  });
  return renderToStaticMarkup(React.createElement(exports.default));
}
const text = (html, className) => html.match(new RegExp(`<p class="[^"]*${className}[^"]*"[^>]*>([^<]*)<`))?.[1] ?? "";
const ageSample = (now, ageMs, good, samples) => ({ good, samples, firstSampleAt: new Date(now - ageMs).toISOString(), lastSampleAt: new Date(now).toISOString() });
const days = 86_400_000;
Given("the uptime clock reads {string}", function (value) { this.now = Date.parse(value); });
Given("a platform with no tallied checks", function () { this.platform = { id: "uptime", name: "Uptime", instances: [url] }; });
Given(/^an instance first checked (\d+) days? ago with (\d+) good checks out of (\d+)(?: and (\d+) unknown results)?$/, function (age, good, samples, unknown) {
  this.platform = { id: "uptime", name: "Uptime", instances: [url] };
  this.platform.uptime = { [url]: ageSample(this.now, Number(age) * days, Number(good), Number(samples)) };
  this.platform.platformUptime = this.platform.uptime[url];
  if (unknown !== undefined) assert.equal(this.platform.uptime[url].samples, Number(samples));
});
Given("an instance first checked 20 seconds ago with 2 good checks out of 2", function () {
  this.platform = { id: "uptime", name: "Uptime", instances: [url] };
  this.platform.uptime = { [url]: ageSample(this.now, 20_000, 2, 2) };
  this.platform.platformUptime = this.platform.uptime[url];
});
Given("two instances where one succeeded 3 of 4 and the other succeeded 1 of 4, never both failing", function () {
  this.platform = { id: "uptime", name: "Uptime", instances: [url, second], uptime: {
    [url]: ageSample(this.now, days, 3, 4), [second]: ageSample(this.now, days, 1, 4),
  }, platformUptime: ageSample(this.now, days, 4, 4) };
});
Then("instance uptime reads {string}", function (expected) { assert.ok(text(renderView(this.platform, this.now), "instance-uptime").includes(expected)); });
Then("platform uptime reads {string}", function (expected) { assert.ok(text(renderView(this.platform, this.now), "platform-uptime").includes(expected)); });
Then("dashboard uptime reads {string}", function (expected) { assert.ok(text(dashboard(this.platform, this.now), "platform-uptime").includes(expected)); });
Then("instance uptime coverage reads {string}", function (expected) { assert.ok(text(renderView(this.platform, this.now), "instance-uptime").includes(expected)); });
Then("instance uptime is provisional", function () { assert.match(text(renderView(this.platform, this.now), "instance-uptime"), /provisional/); });
Then("instance uptime is not provisional", function () { assert.doesNotMatch(text(renderView(this.platform, this.now), "instance-uptime"), /provisional/); });
Then("dashboard uptime is marked below target", function () { assert.match(dashboard(this.platform, this.now), /platform-uptime--below/); });
Then("first instance uptime reads {string}", function (expected) { assert.ok(text(renderView(this.platform, this.now), "instance-uptime").includes(expected)); });
Then("second instance uptime reads {string}", function (expected) {
  const html = renderView(this.platform, this.now);
  const lines = [...html.matchAll(/<p class="instance-uptime[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.ok(lines[1]?.includes(expected));
});
