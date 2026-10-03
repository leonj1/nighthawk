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

test("incident table exposes column labels, state without color, instance, exact times, downtime and detail links", () => {
  const html = render([p([failure])]);
  for (const label of ["Platform", "Status", "Recovered / started", "Down for"]) {
    assert.equal(html.split(`<th scope="col">${label}</th>`).length - 1, 1, label);
  }
  assert.match(html, /<caption class="sr-only">Recent instance incidents<\/caption>/);
  for (const content of ["Ongoing", "Current instance state: down", "Example", "https://a.example.com", 'href="/instances/p"', 'dateTime="2026-10-01T00:00:00Z"', "Down for", "1h 0m"]) assert.ok(html.includes(content), content);
});

test("recovered rows expose both timestamps and a fixed duration", () => {
  const html = render([p([{ status: "healthy", timestamp: "2026-10-01T00:05:00Z" }, failure])]);
  for (const content of ["Recovered", "Current instance state: healthy", "5m 0s", 'dateTime="2026-10-01T00:05:00Z"', 'dateTime="2026-10-01T00:00:00Z"', 'title="Started ']) assert.ok(html.includes(content), content);
});

test("redundant instance URLs are omitted while distinct instance labels remain", () => {
  const instance = "https://www.EXAMPLE.com/";
  const html = render([{ id: "same", name: "example.com", instances: [instance], stateHistory: { [instance]: [failure] } }]);
  assert.ok(html.includes('href="/instances/same">example.com</a>'));
  assert.ok(!html.includes(instance));
  assert.ok(!html.includes('class="incident-instance"'));
  assert.ok(render([p([failure])]).includes('class="incident-instance">https://a.example.com</p>'));
});

test("incidents share one local day heading and recovered rows group by recovery date", () => {
  const date = new Date(2026, 9, 2, 12);
  const previousDate = new Date(2026, 9, 1, 12);
  const started = { status: "warning", timestamp: previousDate.toISOString() };
  const recovered = { status: "healthy", timestamp: date.toISOString() };
  const sameDay = { ...p([{ status: "warning", timestamp: date.toISOString() }]), id: "same-day" };
  const previousDay = { ...p([started]), id: "previous-day" };
  const html = render([p([recovered, started]), sameDay, previousDay]);
  const headings = [...html.matchAll(/<tr class="incident-day">(.*?)<\/tr>/g)].map((match) => match[1]);
  assert.equal(headings.length, 2);
  assert.ok(headings[0].includes(date.toLocaleDateString(undefined, { dateStyle: "medium" })));
  assert.ok(headings[1].includes(previousDate.toLocaleDateString(undefined, { dateStyle: "medium" })));
  assert.equal((html.match(/<tr class="incident-row">/g) ?? []).length, 3);
});

test("consecutive platform names are suppressed visually with accessible names on every row", () => {
  const state = (status, day, minute) => ({ status, timestamp: new Date(2026, 9, day, 12, minute).toISOString() });
  const history = [state("healthy", 2, 5), state("warning", 2, 4), state("healthy", 2, 3), state("warning", 2, 2), state("healthy", 1, 5), state("warning", 1, 4)];
  const html = render([p(history)]);
  assert.equal((html.match(/href="\/instances\/p"/g) ?? []).length, 2, "name reappears on each day");
  assert.equal((html.match(/<span class="sr-only">Example<\/span>/g) ?? []).length, 1);
  assert.equal((html.match(/<tr class="incident-row">/g) ?? []).length, 3);
});

test("a platform name reappears when another platform interrupts its run", () => {
  const state = (status, minute) => ({ status, timestamp: new Date(2026, 9, 2, 12, minute).toISOString() });
  const history = [state("healthy", 5), state("warning", 4), state("healthy", 1), state("warning", 0)];
  const other = { ...p([state("warning", 3)]), id: "other", name: "Other" };
  const html = render([p(history), other]);
  assert.equal((html.match(/href="\/instances\/p"/g) ?? []).length, 2);
  assert.equal((html.match(/<span class="sr-only">Example<\/span>/g) ?? []).length, 0);
});

test("unknown, missing history and unavailable results are explicit", () => {
  assert.match(render([p([{ status: "unknown", timestamp: null }, failure])]), /Recovery unconfirmed/);
  assert.match(render([]), /No incidents in the available history/);
  assert.match(render([], "failed"), /Unable to load incident history/);
  assert.match(render([p([failure])], "failed"), /may be out of date/);
  const missingTime = render([p([{ status: "warning", timestamp: null }])]);
  assert.match(missingTime, /Time unavailable/);
  assert.match(missingTime, /Duration unavailable/);
});
