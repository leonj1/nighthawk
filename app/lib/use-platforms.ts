"use client";
import { useEffect, useState } from "react";
import { storageKey, type Platform } from "./status";

export async function savePlatforms(platforms: Platform[]): Promise<Platform[]> {
  const response = await fetch("/api/platforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(platforms) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to save platforms.");
  return data;
}

export function usePlatforms() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          await savePlatforms(JSON.parse(saved));
          window.localStorage.removeItem(storageKey);
        }
        const response = await fetch("/api/platforms", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load monitoring results.");
        const data: Platform[] = await response.json();
        if (active) { setPlatforms(data); setError(""); }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "Unable to load platforms."); }
      finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return { platforms, setPlatforms, error };
}
