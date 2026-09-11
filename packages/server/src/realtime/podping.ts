/**
 * Podping (https://podping.org) announces podcast feed updates on the Hive
 * blockchain; a relay re-broadcasts them as WebSocket frames:
 *   {"t":"podping","p":[{"p":{"iris":["https://…/feed.xml"],"reason":"update",…}}],…}
 * Only feeds we subscribe to are refreshed; the rest are ignored.
 */

export const DEFAULT_PODPING_URL = "wss://api.livewire.io/ws/podping";

/** Compare feed URLs without scheme, host case, or a trailing slash. */
export function feedKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return null;
  }
}

/** The feed URLs a relay frame says were updated. Malformed frames yield none. */
export function podpingIris(frame: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(frame);
  } catch {
    return [];
  }
  const d = doc as { t?: unknown; p?: unknown };
  if (d.t !== "podping" || !Array.isArray(d.p)) return [];
  const out: string[] = [];
  for (const op of d.p as { p?: { iris?: unknown } }[]) {
    const iris = op?.p?.iris;
    if (Array.isArray(iris)) for (const iri of iris) if (typeof iri === "string") out.push(iri);
  }
  return out;
}
