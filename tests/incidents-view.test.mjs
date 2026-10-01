import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as incidents from "../app/lib/incidents.ts";

const require = createRequire(import.meta.url);
const now = Date.parse("2026-10-01T01:00:00Z");
await loadBindings();
const { code } = await transform(readFileSync(new URL("../app/dashboard/recent-incidents.tsx", import.meta.url), "utf8"), {
  filename: "recent-incidents.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
const exports = {};
runInNewContext(code, { exports, require(name) {
  if (name === "react") return { ...React, useState: () => [now, () => {}] };
  if (name === "../lib/incidents") return incidents;
  if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
  return require(name);
} });
const render = (platforms, error = "") => renderToStaticMarkup(React.createElement(exports.RecentIncidents, { platforms, error }));
const failure = { status: "warning", timestamp: "2026-10-01T00:00:00Z" };
const p = (history) => ({ id: "p", name: "Example", instances: ["https://a.example.com"], stateHistory: { "https://a.example.com": history } });

test("incident rows expose state without color, names, exact times, downtime and detail links", () => {
  const html = render([p([failure])]);
  for (const content of ["Ongoing", "Current instance state: down", "Example", "https://a.example.com", 'href="/instances/p"', 'dateTime="2026-10-01T00:00:00Z"', "Down for", "1h 0m"]) assert.ok(html.includes(content), content);
});

test("recovered rows expose both timestamps and a fixed duration", () => {
  const html = render([p([{ status: "healthy", timestamp: "2026-10-01T00:05:00Z" }, failure])]);
  for (const content of ["Recovered", "Current instance state: healthy", "Was down for", "5m 0s", 'dateTime="2026-10-01T00:05:00Z"', 'dateTime="2026-10-01T00:00:00Z"']) assert.ok(html.includes(content), content);
});

test("unknown, missing history and unavailable results are explicit", () => {
  assert.match(render([p([{ status: "unknown", timestamp: null }, failure])]), /Recovery unconfirmed/);
  assert.match(render([]), /No incidents in the available history/);
  assert.match(render([], "failed"), /Unable to load incident history/);
  assert.match(render([p([failure])], "failed"), /may be out of date/);
});
