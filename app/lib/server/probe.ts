import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

export function publicAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}

export async function probe(target: string, signal: AbortSignal, redirects = 0): Promise<boolean> {
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) return false;
  const result = await new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      signal,
      family: 4,
      headers: { "User-Agent": "Nighthawk health monitor" },
      lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, location: response.headers.location });
      response.destroy();
    });
    request.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.location && redirects < 3) {
    return probe(new URL(result.location, url).href, signal, redirects + 1);
  }
  return result.status >= 200 && result.status < 300;
}
