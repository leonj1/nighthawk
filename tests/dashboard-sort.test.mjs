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

function findSelect(node) {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === "select" && node.props.id === "platform-sort") return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const select = findSelect(child);
    if (select) return select;
  }
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
