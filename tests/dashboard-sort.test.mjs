import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as status from "../app/lib/status.ts";
import * as uptime from "../app/lib/uptime.ts";

const require = createRequire(import.meta.url);
await loadBindings();
const { code } = await transform(readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8"), {
  filename: "page.tsx",
  jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const element = findElement(child, predicate);
    if (element) return element;
  }
}

function findSelect(node) {
  return findElement(node, (element) => element.type === "select" && element.props.id === "platform-sort");
}

test("dashboard sort menu switches the rendered platform cards between both SLA directions", () => {
  const sample = (good) => ({ good, samples: 100, firstSampleAt: "2026-09-01T00:00:00Z", lastSampleAt: "2026-09-30T00:00:00Z" });
  const platforms = [
    { id: "high", name: "high", instances: [], platformUptime: sample(100) },
    { id: "none", name: "none", instances: [] },
    { id: "low", name: "low", instances: [], platformUptime: sample(50) },
  ];
  let sort = "status";
  const exports = {};
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return {
        ...React,
        useEffect: () => {},
        useState: (initial) => initial === "status" ? [sort, (value) => { sort = value; }] : [initial, () => {}],
      };
      if (name === "../lib/status") return status;
      if (name === "../lib/uptime") return uptime;
      if (name === "../lib/use-platforms") return { usePlatforms: () => ({ platforms }) };
      if (name === "../lib/health-url") return {};
      if (name === "./recent-incidents") return { RecentIncidents: () => null };
      if (name === "./status-help") return { StatusLegend: () => null, StatusInfo: () => null };
      if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
      return require(name);
    },
  });
  const initial = exports.default();
  const select = findSelect(initial);
  assert.ok(select, "Dashboard exposes a sort selector");
  assert.equal(select.props.value, "status");
  const markup = renderToStaticMarkup(initial);
  assert.match(markup, /value="sla-ascending">SLA \(ascending\)/);
  assert.match(markup, /value="sla-descending">SLA \(descending\)/);

  for (const [value, expected] of [
    ["sla-ascending", ["low", "high", "none"]],
    ["sla-descending", ["high", "low", "none"]],
    ["alphabetical", ["high", "low", "none"]],
  ]) {
    select.props.onChange({ target: { value } });
    const view = exports.default();
    assert.equal(findSelect(view).props.value, value);
    const ids = [...renderToStaticMarkup(view).matchAll(/href="\/instances\/([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, expected);
  }
});

test("dashboard name filter updates cards as typed, preserves sorting, and clears", () => {
  let platforms = [
    { id: "beta", name: "beta.example.com", instances: [] },
    { id: "alpha", name: "Alpha.example.com", instances: [] },
    { id: "other", name: "other.test", instances: [] },
  ];
  const states = [];
  let hookIndex = 0;
  const exports = {};
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return {
        ...React,
        useEffect: () => {},
        useState: (initial) => {
          const index = hookIndex++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (value) => { states[index] = value; }];
        },
      };
      if (name === "../lib/status") return status;
      if (name === "../lib/uptime") return uptime;
      if (name === "../lib/use-platforms") return { usePlatforms: () => ({ platforms }) };
      if (name === "../lib/health-url") return {};
      if (name === "./recent-incidents") return {
        RecentIncidents: ({ platforms }) => React.createElement("aside", { "data-platform-count": platforms.length }),
      };
      if (name === "./status-help") return { StatusLegend: () => null, StatusInfo: () => null };
      if (name === "next/link") return ({ children, ...props }) => React.createElement("a", props, children);
      return require(name);
    },
  });
  function render() {
    hookIndex = 0;
    return exports.default();
  }
  function filterInput(view) {
    return findElement(view, (element) => element.type === "input" && element.props.id === "platform-filter");
  }
  function cardIds(view) {
    return [...renderToStaticMarkup(view).matchAll(/href="\/instances\/([^"]+)"/g)].map((match) => match[1]);
  }
  function search(value) {
    filterInput(render()).props.onChange({ target: { value } });
    const view = render();
    assert.equal(filterInput(view).props.value, value);
    return view;
  }

  const initial = render();
  assert.equal(filterInput(initial).props.type, "search");
  assert.match(renderToStaticMarkup(initial), /<label for="platform-filter">Filter by platform name<\/label>/);
  assert.deepEqual(cardIds(initial), ["alpha", "beta", "other"]);

  let view = search("  ALPHA.EXAMPLE.COM  ");
  assert.deepEqual(cardIds(view), ["alpha"]);
  assert.match(renderToStaticMarkup(view), /1 of 3 shown/);
  assert.match(renderToStaticMarkup(view), /data-platform-count="3"/);

  view = search("EXAMPLE");
  findSelect(view).props.onChange({ target: { value: "alphabetical" } });
  view = render();
  assert.deepEqual(cardIds(view), ["alpha", "beta"]);
  assert.equal(findSelect(view).props.value, "alphabetical");

  // A monitoring refresh must keep applying the current filter.
  platforms = [...platforms, { id: "gamma", name: "gamma.example.com", instances: [] }];
  assert.deepEqual(cardIds(render()), ["alpha", "beta", "gamma"]);

  view = search("missing");
  assert.deepEqual(cardIds(view), []);
  assert.match(renderToStaticMarkup(view), /No platforms match your search\./);
  assert.match(renderToStaticMarkup(view), /0 of 4 shown/);

  const clear = findElement(view, (element) => element.type === "button" && element.props.children === "Clear");
  assert.ok(clear);
  clear.props.onClick();
  view = render();
  assert.equal(filterInput(view).props.value, "");
  assert.deepEqual(cardIds(view), ["alpha", "beta", "gamma", "other"]);
  assert.doesNotMatch(renderToStaticMarkup(view), /No platforms match/);
  assert.match(renderToStaticMarkup(view), /4 total/);

  assert.deepEqual(cardIds(search("   ")), ["alpha", "beta", "gamma", "other"]);
  platforms = [];
  assert.deepEqual(cardIds(search("example")), []);
  assert.match(renderToStaticMarkup(render()), /No platforms match your search\./);
});
