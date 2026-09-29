export function healthUrl(instance: string, endpoint = ""): string {
  const base = new URL(instance.includes("://") ? instance.trim() : `https://${instance.trim()}`);
  const url = endpoint.trim() ? new URL(endpoint.trim(), base) : base;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new Error("Use an HTTP or HTTPS URL without credentials.");
  }
  url.hash = "";
  return url.href;
}
