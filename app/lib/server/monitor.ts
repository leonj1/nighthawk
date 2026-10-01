import type { Platform } from "../status.ts";
import { healthUrl } from "../health-url.ts";
import { probe } from "./probe.ts";
import { PlatformStore } from "./storage.ts";

const interval = 10_000;

export class Monitor {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  readonly store: PlatformStore;
  private check: typeof probe;
  private now: () => string;
  private timeout: number;

  constructor(store: PlatformStore, check: typeof probe = probe,
    now: () => string = () => new Date().toISOString(), timeout = 8_000) {
    this.store = store;
    this.check = check;
    this.now = now;
    this.timeout = timeout;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(console.error); }, interval);
    this.timer.unref();
    void this.tick().catch(console.error);
  }

  stop() { clearInterval(this.timer); this.timer = undefined; }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Wait for every platform even if one database write fails, so a new tick
      // cannot overlap requests still in flight from this cycle.
      const completed = await Promise.allSettled(this.store.list().map(async (platform) => {
        const revision = this.store.revision(platform.id);
        const results = await Promise.all(platform.instances.map(async (instance) => {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              this.check(healthUrl(instance, platform.healthUrls?.[instance]), controller.signal),
              new Promise<boolean>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(false); }, this.timeout); }),
            ]);
          } catch { return false; }
          finally { clearTimeout(timer); }
        }));
        this.store.recordCycle(platform.id, Object.fromEntries(platform.instances.map((url, i) => [url, results[i]])), this.now(), revision);
      }));
      const failures = completed.filter((result) => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Unable to persist monitoring cycle.");
    } finally { this.running = false; }
  }
}

const globalMonitor = globalThis as typeof globalThis & { nighthawkMonitor?: Monitor };
function monitor() { return globalMonitor.nighthawkMonitor ??= new Monitor(new PlatformStore()); }
export async function startMonitor() { monitor().start(); }
export async function tick() { await monitor().tick(); }
export async function getPlatforms() { await startMonitor(); return monitor().store.list(); }

export function validatePlatform(value: unknown): Platform {
  const input = value as Platform;
  if (!input || typeof input.id !== "string" || !input.id || input.id.length > 100 ||
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
  const createdAt = new Date().toISOString();
  return {
    id: input.id, name: input.name.trim(), instances, healthUrls, createdAt,
    platformStateHistory: [{ status: "unknown", timestamp: createdAt }],
    stateHistory: Object.fromEntries(instances.map((instance) => [instance, [{ status: "unknown", timestamp: createdAt }]])),
  };
}

export async function addPlatforms(inputs: unknown[]) {
  const additions = inputs.map(validatePlatform);
  await startMonitor();
  monitor().store.add(additions);
  return monitor().store.list();
}
