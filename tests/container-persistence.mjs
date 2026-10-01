// Opt-in acceptance check: builds the real Node 24 image and replaces the
// container while keeping a bind-mounted data directory inside this workspace.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, chmodSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

const directory = mkdtempSync(path.join(process.cwd(), ".container-test-"));
chmodSync(directory, 0o777); // A mounted directory must be writable by image UID 1001.
const image = `nighthawk-persistence-test:${process.pid}`;
const manifest = path.join(process.cwd(), ".cw-servers.json");
const previousManifest = existsSync(manifest) ? readFileSync(manifest, "utf8") : null;
let container;
function docker(...args) { return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim(); }
async function start() {
  container = docker("run", "-d", "--mount", `type=bind,source=${directory},target=/app/data`, "-p", "0.0.0.0::8080", image);
  const port = Number(docker("port", container, "8080/tcp").split(":").at(-1));
  const servers = previousManifest ? JSON.parse(previousManifest).servers : [];
  writeFileSync(manifest, JSON.stringify({ servers: [...servers, { port, name: "SQLite container persistence acceptance test" }] }));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch {}
    await setTimeout(200);
  }
  throw new Error(`Container did not become ready: ${docker("logs", container)}`);
}
try {
  execFileSync("docker", ["build", "-t", image, "."], { stdio: "inherit" });
  let base = await start();
  assert.equal(docker("exec", container, "id", "-u"), "1001");
  const response = await fetch(`${base}/api/platforms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([
    { id: "container", name: "Container", instances: ["http://127.0.0.1/"], healthUrls: { "http://127.0.0.1/": "/health" } },
  ]) });
  assert.equal(response.status, 200);
  const created = (await response.json())[0];
  assert.deepEqual(created.platformStateHistory.map((s) => s.status), ["unknown"]);
  let before;
  for (let i = 0; i < 100; i++) {
    [before] = await (await fetch(`${base}/api/platforms`)).json();
    if (before.checkedAt) break;
    await setTimeout(200);
  }
  assert.deepEqual(before.platformStateHistory.map((s) => s.status), ["critical", "unknown"]);
  docker("exec", container, "node", "scripts/backup.mjs", "/app/data/verified-backup.sqlite");
  docker("rm", "-f", container); container = undefined;
  base = await start();
  const [after] = await (await fetch(`${base}/api/platforms`)).json();
  for (const key of ["id", "name", "instances", "healthUrls", "createdAt", "stateHistory", "platformStateHistory"]) assert.deepEqual(after[key], before[key]);
  assert.equal(after.checks["http://127.0.0.1/"][0], false);
  assert.ok(after.checkTimes.includes(before.checkedAt));
  assert.ok(existsSync(path.join(directory, "nighthawk.sqlite")));
  console.log("Container replacement preserved platforms, instances, checks and transition timestamps; mounted directory and backup verified.");
} finally {
  if (container) docker("rm", "-f", container);
  try { docker("image", "rm", image); } catch {}
  if (previousManifest === null) rmSync(manifest, { force: true }); else writeFileSync(manifest, previousManifest);
  rmSync(directory, { recursive: true, force: true });
}
