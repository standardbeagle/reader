import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Raised when a URL resolves to a non-public address and outbound fetch is refused. */
export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inV4Range(ip: number, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(net!) & mask);
}

// Ranges that must never be reachable from a user-triggered fetch: loopback,
// private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, benchmark,
// documentation, multicast, reserved, and broadcast.
const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
  "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
  "255.255.255.255/32",
];

function isBlockedV4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  return BLOCKED_V4.some((cidr) => inV4Range(asInt, cidr));
}

function isBlockedV6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]!; // drop zone id
  if (addr === "::1" || addr === "::") return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) return isBlockedV4(mapped[1]!);
  const firstHextet = Number.parseInt(addr.split(":")[0] || "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True for any address a public fetch must refuse to connect to. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not a parseable IP literal — refuse rather than guess
}

function enforcedByDefault(): boolean {
  // Integration tests fetch loopback fixture servers; the guard would reject
  // every one. Vitest sets VITEST=true, so disable enforcement there. Callers
  // that must test the guard itself pass { enforce: true }.
  return !(process.env.VITEST === "true" || process.env.READER_ALLOW_PRIVATE_FETCH === "1");
}

/**
 * Reject a URL whose host is not a public address. Resolves DNS names to every
 * A/AAAA record and refuses if any is private/loopback/link-local. Note: this
 * validates the name, not the socket, so it is not by itself proof against DNS
 * rebinding between check and connect — call it again after each redirect hop.
 */
export async function assertPublicUrl(raw: string, opts: { enforce?: boolean } = {}): Promise<void> {
  if (!(opts.enforce ?? enforcedByDefault())) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError(`invalid url: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedAddressError(`blocked protocol: ${url.protocol}`);
  }
  const host = url.hostname;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new BlockedAddressError(`blocked address: ${host}`);
    return;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new BlockedAddressError(`cannot resolve host: ${host}`);
  }
  if (records.length === 0) throw new BlockedAddressError(`no address for host: ${host}`);
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new BlockedAddressError(`host ${host} resolves to blocked address ${record.address}`);
    }
  }
}
