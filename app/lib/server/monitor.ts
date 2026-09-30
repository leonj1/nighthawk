import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Platform } from "../status.ts";
import { healthUrl } from "../health-url.ts";
import { probe } from "./probe.ts";

const interval = 10_000;
const file = path.join(process.env.NIGHTHAWK_DATA_DIR || path.join(process.cwd(), "data"), "platforms.json");
type State = { platforms: Platform[]; ready?: Promise<void>; timer?: ReturnType<typeof setInterval>; running: boolean; writes: Promise<void> };
const globalMonitor = globalThis as typeof globalThis & { nighthawkMonitor?: State };
const state = globalMonitor.nighthawkMonitor ??= { platforms: [], running: false, writes: Promise.resolve() };

function save() {
  const contents = JSON.stringify(state.platforms);
  const write = state.writes.catch(() => {}).then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, contents);
    await rename(`${file}.tmp`, file);
  });
  state.writes = write;
  return write;
}

export async function startMonitor() {
  state.ready ??= (async () => {
    try { state.platforms = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  })();
  await state.ready;
  if (!state.timer) {
    state.timer = setInterval(() => { void tick().catch(console.error); }, interval);
    state.timer.unref();
    void tick().catch(console.error);
  }
}

export async function tick() {
  if (state.running) return;
  state.running = true;
  try {
    await Promise.all(state.platforms.map(async (platform) => {
      const results = await Promise.all(platform.instances.map(async (instance) => {
        try {
          const signal = AbortSignal.timeout(8_000);
          return await Promise.race([
            probe(healthUrl(instance, platform.healthUrls?.[instance]), signal),
            new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })),
          ]);
        } catch { return false; }
      }));
      platform.checks = Object.fromEntries(platform.instances.map((instance, index) => [instance,
        [results[index], ...(platform.checks?.[instance] ?? [])].slice(0, 3),
      ]));
      const checkedAt = new Date().toISOString();
      platform.checkTimes = [checkedAt, ...(platform.checkTimes ?? [platform.checkedAt ?? null])].slice(0, 3);
      platform.checkedAt = checkedAt;
    }));
    await save();
  } finally { state.running = false; }
}

export async function getPlatforms() { await startMonitor(); return state.platforms; }

export function validatePlatform(value: unknown): Platform {
  const input = value as Platform;
  if (!input || typeof input.id !== "string" || input.id.length > 100 ||
      typeof input.name !== "string" || !input.name.trim() || input.name.length > 253 ||
      !Array.isArray(input.instances) || !input.instances.length || input.instances.length > 50) {
    throw new Error("Provide a platform name and 1–50 instances.");
  }
  const instances = input.instances.map((instance) => {
    if (typeof instance !== "string" || instance.length > 2048) throw new Error("Invalid instance URL.");
    return healthUrl(instance);
  });
  if (new Set(instances).size !== instances.length) throw new Error("Each instance URL must be unique.");
  const healthUrls = Object.fromEntries(instances.map((instance, index) => {
    const endpoint = input.healthUrls?.[input.instances[index]] ?? "";
    if (typeof endpoint !== "string" || endpoint.length > 2048) throw new Error("Invalid health-check URL.");
    return [instance, healthUrl(instance, endpoint)];
  }));
  return { id: input.id, name: input.name.trim(), instances, healthUrls };
}

export async function addPlatforms(inputs: unknown[]) {
  const additions = inputs.map(validatePlatform);
  await startMonitor();
  for (const platform of additions) {
    if (!state.platforms.some((existing) => existing.id === platform.id || existing.name === platform.name)) {
      if (state.platforms.length >= 100) throw new Error("The limit is 100 platforms.");
      state.platforms.unshift(platform);
    }
  }
  await save();
  return state.platforms;
}
