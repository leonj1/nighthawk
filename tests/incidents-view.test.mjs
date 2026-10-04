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
  if (name === "react") return { ...React, useState: (initial) => [initial === null ? now : initial, () => {}] };
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

test("consecutive platform names stay compact across hours within the same day", () => {
  const recoveredPlatform = (id, name, events) => {
    const instance = `https://${name}`;
    return {
      id, name, instances: [instance],
      stateHistory: { [instance]: events.flatMap(([hour, minute, second, duration]) => {
        const recoveredAt = new Date(2026, 9, 2, hour, minute, second).getTime();
        return [
          { status: "healthy", timestamp: new Date(recoveredAt).toISOString() },
          { status: "warning", timestamp: new Date(recoveredAt - duration * 1000).toISOString() },
        ];
      }) },
    };
  };
  const platforms = [
    recoveredPlatform("compute", "compute-wizard.com", [
      [22, 15, 58, 9], [22, 9, 58, 10], [21, 34, 37, 10], [21, 12, 37, 10],
      [20, 2, 0, 6], [20, 1, 30, 6], [17, 59, 33, 9], [17, 8, 2, 0],
    ]),
    recoveredPlatform("lrscribe", "lrscribe.com", [[17, 8, 4, 0]]),
    recoveredPlatform("lrscribe-server", "lrscribe.joseserver.com", [[17, 8, 3, 0]]),
  ];
  const before = structuredClone(platforms);
  const data = incidents.recentIncidents(platforms);
  assert.equal(data.length, 10);
  assert.deepEqual(data.map((incident) => incident.platformName), [
    ...Array(7).fill("compute-wizard.com"), "lrscribe.com", "lrscribe.joseserver.com", "compute-wizard.com",
  ], "every incident still has its platform name before rendering");

  const rows = [...render(platforms).matchAll(/<tr class="incident-row">(.*?)<\/tr>/g)].map((match) => match[1]);
  assert.equal(rows.length, 10, "no incidents were dropped");
  rows.forEach((row, index) => {
    const incident = data[index];
    const cell = row.match(/<td class="incident-platform">(.*?)<\/td>/)[1];
    if (index >= 1 && index <= 6) {
      assert.equal(cell, '<span class="sr-only">compute-wizard.com</span>',
        "the repeated name is only available to screen readers and no instance label remains");
    } else {
      assert.equal(cell, `<a href="/instances/${incident.platformId}">${incident.platformName}</a>`);
    }
    assert.ok(row.includes("Recovered"));
    assert.ok(row.includes(`dateTime="${incident.recoveredAt}"`));
    assert.ok(row.includes(`<strong>${incidents.incidentDuration(incident, now)}</strong>`));
  });
  assert.deepEqual(platforms, before, "rendering preserves the source data");

  // A distinct hostname leaves a visible instance label even when the name repeats.
  const instance = "https://worker.compute-wizard.com";
  const distinctHost = { ...platforms[0], instances: [instance], stateHistory: {
    [instance]: platforms[0].stateHistory[platforms[0].instances[0]],
  } };
  const distinctRows = [...render([distinctHost, ...platforms.slice(1)]).matchAll(/<tr class="incident-row">(.*?)<\/tr>/g)];
  for (const [index, match] of distinctRows.entries()) {
    if (index >= 1 && index <= 6) {
      assert.ok(match[1].includes('<span class="sr-only">compute-wizard.com</span>'));
      assert.ok(match[1].includes(`<p class="incident-instance">${instance}</p>`));
    }
  }
});

test("day headings combine different hours with incident counts and accessible disclosure controls", () => {
  const state = (hour, minute) => ({ status: "warning", timestamp: new Date(2026, 9, 2, hour, minute).toISOString() });
  const html = render([
    p([state(15, 40)]), { ...p([state(15, 10)]), id: "second" }, { ...p([state(14, 59)]), id: "third" },
    { ...p([{ status: "warning", timestamp: new Date(2026, 9, 1, 23, 59).toISOString() }]), id: "previous" },
  ]);
  const headings = [...html.matchAll(/<tr class="incident-day">(.*?)<\/tr>/g)].map((match) => match[1]);
  assert.equal(headings.length, 2);
  for (const [index, day] of [2, 1].entries()) {
    assert.ok(headings[index].includes(new Date(2026, 9, day).toLocaleDateString(undefined, { dateStyle: "medium" })));
    assert.match(headings[index], /aria-expanded="true"/);
  }
  assert.match(headings[0], /3 incidents/);
  assert.match(headings[1], /1 incident/);
  assert.doesNotMatch(html, /incident-hour|Hour unavailable|grouped by local day and hour/);
  assert.equal((html.match(/aria-expanded=/g) ?? []).length, 2, "only days have disclosure controls");
  assert.match(html, /Expand all/);
  assert.match(html, /Collapse all/);
  for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) {
    for (const id of match[1].split(" ")) assert.ok(html.includes(`id="${id}"`), id);
  }
});

test("day toggles hide all their incidents, survive refresh, and support bulk actions", () => {
  // Capture real JSX handlers and keep hook state across renders to exercise the controls.
  const hooks = [];
  let cursor = 0;
  let buttons = [];
  const runtime = require("react/jsx-runtime");
  const capture = (factory) => (type, props, key) => {
    if (type === "button") buttons.push(props);
    return factory(type, props, key);
  };
  const interactive = {};
  runInNewContext(code, { exports: interactive, require(name) {
    if (name === "react") return { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial === null ? now : initial;
      return [hooks[index], (update) => { hooks[index] = typeof update === "function" ? update(hooks[index]) : update; }];
    } };
    if (name === "react/jsx-runtime") return { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) };
    if (name === "../lib/incidents") return incidents;
    if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
    return require(name);
  } });
  const state = (day, hour, minute) => ({ status: "warning", timestamp: new Date(2026, 9, day, hour, minute).toISOString() });
  let platforms = [p([state(2, 15, 10)]), { ...p([state(2, 14, 10)]), id: "second" }, { ...p([state(1, 15, 10)]), id: "third" }];
  const draw = () => {
    cursor = 0;
    buttons = [];
    return renderToStaticMarkup(React.createElement(interactive.RecentIncidents, { platforms, error: "" }));
  };
  const hiddenGroups = (html) => (html.match(/<tbody[^>]* hidden=""/g) ?? []).length;
  const days = () => buttons.filter((button) => button["aria-controls"]);
  assert.equal(hiddenGroups(draw()), 0);
  assert.equal(days().length, 2);
  days()[0].onClick();
  const collapsedDay = draw();
  assert.equal(hiddenGroups(collapsedDay), 1, "the day hides one row group containing both hours");
  const contents = collapsedDay.match(/<tbody[^>]* hidden="">(.*?)<\/tbody>/)[1];
  assert.equal((contents.match(/class="incident-row"/g) ?? []).length, 2);
  assert.equal(days()[0]["aria-expanded"], false);
  assert.equal(days()[1]["aria-expanded"], true, "the other day stays open");
  platforms = structuredClone(platforms);
  assert.equal(hiddenGroups(draw()), 1, "polling new platform objects preserves the selection");
  days()[0].onClick();
  assert.equal(hiddenGroups(draw()), 0, "reopening the day shows all its incidents");
  buttons.find((button) => button.children === "Collapse all").onClick();
  assert.equal(hiddenGroups(draw()), 2);
  assert.ok(days().every((button) => button["aria-expanded"] === false));
  buttons.find((button) => button.children === "Expand all").onClick();
  assert.equal(hiddenGroups(draw()), 0);
  assert.ok(days().every((button) => button["aria-expanded"] === true));
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
