import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { Given, When, Then } from "@cucumber/cucumber";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as status from "../../../app/lib/status.ts";
import * as checkTime from "../../../app/lib/check-time.ts";

const require = createRequire(import.meta.url);
const instance = "https://example.com/";
const source = readFileSync(new URL("../../../app/instances/instances-view.tsx", import.meta.url), "utf8");
await loadBindings();
const { code: compiled } = await transform(source, {
  filename: "instances-view.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});

// Render the real view and real status functions, replacing only data fetching
// and Next navigation. No network, running Next server, or real timers required.
export function renderView(platform, now) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react" && now !== undefined) return { ...React, useState: () => [now, () => {}] };
      if (name === "../lib/use-platforms") return { usePlatforms: () => ({ platforms: [platform] }) };
      if (name === "../lib/status") return status;
      if (name === "../lib/check-time") return checkTime;
      if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
      return require(name);
    },
  });
  return renderToStaticMarkup(React.createElement(exports.default, { platformId: platform.id }));
}

export function boxes(platform, scope = "instance") {
  const html = renderView(platform);
  const article = scope === "platform"
    ? html.match(/<section\b[^>]*class="platform-summary"[^>]*>([\s\S]*?)<\/section>/)?.[1]
    : html.match(/<article\b[^>]*class="instance-column"[^>]*>([\s\S]*?)<\/article>/)?.[1];
  assert.ok(article, "The instance must be rendered in the real detail view");
  return [...article.matchAll(/class="instance-status instance-status--([a-z]+)"/g)].map((match) => match[1]);
}

const colorStatus = { gray: "unknown", green: "healthy", amber: "warning" };

Given("a newly added instance with no completed health checks", function () {
  this.platform = { id: "bdd-platform", name: "BDD platform", instances: [instance] };
});

When("monitoring reports {string}", function (results) {
  // Supply raw check observations, never the expected state-change history.
  // Keeping all observations lets these tests detect view-level truncation.
  this.platform.checks = { [instance]: results.split(", ").map((result) => {
    assert.ok(["online", "offline"].includes(result), `Unsupported result: ${result}`);
    return result === "online";
  }).reverse() };
});

Then("the latest instance box is {word}", function (color) {
  assert.ok(colorStatus[color], `Unsupported color: ${color}`);
  assert.equal(boxes(this.platform)[0], colorStatus[color]);
});

Then("the instance has {int} state boxes", function (count) {
  assert.equal(boxes(this.platform).length, count, "One initial box plus one box per state change");
});

Then("the instance boxes from newest to oldest are {string}", function (colors) {
  const expected = colors.split(", ").map((color) => {
    assert.ok(colorStatus[color], `Unsupported color: ${color}`);
    return colorStatus[color];
  });
  assert.deepEqual(boxes(this.platform), expected);
});

Then("the platform boxes from newest to oldest are {string}", function (colors) {
  const expected = colors.split(", ").map((color) => {
    const statuses = { ...colorStatus, red: "critical" };
    assert.ok(statuses[color], `Unsupported color: ${color}`);
    return statuses[color];
  });
  assert.deepEqual(boxes(this.platform, "platform"), expected);
});
