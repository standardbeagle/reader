import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fetchCapped } from "../fetch.js";
import { assertPublicUrl } from "../net-guard.js";

// Client for Libby's sync service (OverDrive's sentry-read) and the public
// catalog (thunder). The sync service is private and undocumented: endpoints
// and field names here follow the community clients (libby-calibre-plugin,
// booklife-mcp), and every field of a hold except its id and title is read
// as optional, so a renamed field shows up as a missing detail rather than a
// wrong one.

const SENTRY_HOST = "sentry-read.svc.overdrive.com";
// The sync host serves a certificate issued for *.odrsre.overdrive.com, which
// does not cover its public name. Asking for the name the certificate does
// cover keeps chain and hostname verification on; the alternative every other
// client reaches for is switching verification off.
const SENTRY_CERT_NAME = "sentry-read.odrsre.overdrive.com";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** Used when a library card does not report its own lending period. */
const DEFAULT_LOAN_DAYS = 21;

/** Where sync calls go. READER_LIBBY_URL points tests at a fixture. */
export const libbyOrigin = (): string => new URL(process.env.READER_LIBBY_URL ?? `https://${SENTRY_HOST}`).origin;
const catalogOrigin = (): string => process.env.READER_LIBBY_CATALOG_URL ?? "https://thunder.api.overdrive.com";

// Libby's web app headers; the service answers browsers, not API clients.
const LIBBY_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.2 Safari/605.1.15",
  accept: "application/json",
  referer: "https://libbyapp.com/",
  origin: "https://libbyapp.com",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

/** The sync service refused or failed a request. `status` is its HTTP code, 0 for a transport failure. */
export class LibbyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LibbyError";
  }
}

export interface LibbyCard {
  cardId: string;
  /** Library name. */
  library: string;
  /** The library's catalog key, for search and title links. */
  libraryKey: string | null;
  /** Default loan length in days per format, where the card reports one. */
  loanDays: Record<string, number>;
}

export interface LibbyHold {
  titleId: string;
  cardId: string;
  title: string;
  author: string | null;
  /** ebook, audiobook, magazine. */
  format: string | null;
  /** The patron's place in the queue. */
  position: number | null;
  holdsCount: number | null;
  ownedCopies: number | null;
  estimatedWaitDays: number | null;
  /** The copy is waiting to be borrowed. */
  ready: boolean;
  placedAt: string | null;
  /** While ready: when the reservation lapses. */
  expiresAt: string | null;
  /** Set while the hold is suspended (it keeps its place but cannot become ready). */
  suspendedUntil: string | null;
  coverUrl: string | null;
}

export interface LibbySync {
  cards: LibbyCard[];
  holds: LibbyHold[];
  /** Titles currently on loan, as `cardId:titleId`. */
  loans: Set<string>;
}

export interface CatalogTitle {
  titleId: string;
  title: string;
  author: string | null;
  format: string | null;
  available: boolean;
  ownedCopies: number | null;
  holdsCount: number | null;
  estimatedWaitDays: number | null;
  coverUrl: string | null;
}

interface SyncResponse { status: number; json: unknown }

function syncRequest(method: string, path: string, opts: { token?: string; form?: Record<string, string>; json?: unknown } = {}): Promise<SyncResponse> {
  const url = new URL(path, libbyOrigin());
  const body = opts.form ? new URLSearchParams(opts.form).toString() : opts.json !== undefined ? JSON.stringify(opts.json) : undefined;
  const headers: Record<string, string> = {
    ...LIBBY_HEADERS,
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
    ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}),
  };
  return assertPublicUrl(url.href).then(() => new Promise<SyncResponse>((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, {
      method, headers, timeout: TIMEOUT_MS,
      ...(url.hostname === SENTRY_HOST ? { servername: SENTRY_CERT_NAME } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) return req.destroy(new Error("response too large"));
        chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* a non-JSON body is reported by status below */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  })).catch((e: unknown) => {
    if (e instanceof LibbyError) throw e;
    throw new LibbyError(`could not reach Libby: ${e instanceof Error ? e.message : String(e)}`, 0);
  });
}

/** A successful JSON object, or a LibbyError naming what was being done. */
async function syncCall(action: string, method: string, path: string, opts: Parameters<typeof syncRequest>[2] = {}): Promise<Record<string, unknown>> {
  const res = await syncRequest(method, path, opts);
  if (res.status === 401 || res.status === 403) throw new LibbyError("Libby no longer accepts this sign-in — link the account again", res.status);
  if (res.status < 200 || res.status >= 300) {
    const detail = (res.json as { result?: unknown } | null)?.result;
    throw new LibbyError(`Libby could not ${action}: HTTP ${res.status}${typeof detail === "string" ? ` (${detail})` : ""}`, res.status);
  }
  return res.json && typeof res.json === "object" ? res.json as Record<string, unknown> : {};
}

function identityOf(body: Record<string, unknown>, action: string): string {
  if (typeof body.identity !== "string" || !body.identity) throw new LibbyError(`Libby did not return a sign-in token when asked to ${action}`, 200);
  return body.identity;
}

/** When a sign-in token stops working, from its `exp` claim; null if it carries none. */
export function tokenExpiry(token: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Sign in as a new device from a setup code (Libby: Settings, Copy To Another
 * Device). The code is single-use and short-lived; it is sent once and never stored.
 */
export async function signInWithCode(code: string): Promise<string> {
  const anonymous = identityOf(await syncCall("start a device", "POST", "/chip?client=dewey"), "start a device");
  const res = await syncRequest("POST", "/chip/clone/code", { token: anonymous, form: { code } });
  if (res.status === 404) throw new LibbyError("Libby did not accept that setup code — codes are single-use and expire within about a minute", 404);
  if (res.status !== 200) throw new LibbyError(`Libby could not link this device: HTTP ${res.status}`, res.status);
  const linked = (res.json as { identity?: unknown } | null)?.identity;
  return typeof linked === "string" && linked ? linked : anonymous;
}

/** A fresh token for the same device. Libby has no refresh token; the app re-asks for its chip. */
export async function renewSignIn(token: string): Promise<string> {
  return identityOf(await syncCall("renew the sign-in", "POST", "/chip?client=dewey", { token }), "renew the sign-in");
}

const str = (v: unknown): string | null => typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const cover = (covers: unknown): string | null => str(obj(obj(covers).cover300Wide).href) ?? str(obj(obj(covers).cover150Wide).href);

function parseCard(raw: unknown): LibbyCard | null {
  const card = obj(raw);
  const cardId = str(card.cardId);
  if (!cardId) return null;
  const loanDays: Record<string, number> = {};
  for (const [format, period] of Object.entries(obj(card.lendingPeriods))) {
    const preference = obj(period).preference;
    if (Array.isArray(preference) && typeof preference[0] === "number" && preference[1] === "days") loanDays[format] = preference[0];
  }
  return { cardId, library: str(obj(card.library).name) ?? str(card.cardName) ?? "Library", libraryKey: str(card.advantageKey), loanDays };
}

/** The whole account in one call: every card, every hold, every loan. */
export async function syncAccount(token: string): Promise<LibbySync> {
  const body = await syncCall("sync the account", "GET", "/chip/sync", { token });
  const cards = (Array.isArray(body.cards) ? body.cards : []).map(parseCard).filter((c): c is LibbyCard => c !== null);
  // An unlinked or logged-out device syncs fine and simply has no cards.
  // Reporting that as "no holds" would announce every hold as cancelled.
  if (body.result !== "synchronized" || cards.length === 0) {
    throw new LibbyError("Libby has no library cards for this sign-in — link the account again", 200);
  }
  const holds = (Array.isArray(body.holds) ? body.holds : []).map((raw): LibbyHold => {
    const hold = obj(raw);
    const titleId = str(hold.id);
    const title = str(hold.title);
    const cardId = str(hold.cardId) ?? (cards.length === 1 ? cards[0]!.cardId : null);
    if (!titleId || !title || !cardId) throw new LibbyError("Libby returned a hold without an id, title or card", 200);
    return {
      titleId, cardId, title,
      author: str(hold.firstCreatorName),
      format: str(obj(hold.type).id),
      position: num(hold.holdListPosition),
      holdsCount: num(hold.holdsCount),
      ownedCopies: num(hold.ownedCopies),
      estimatedWaitDays: num(hold.estimatedWaitDays),
      ready: hold.isAvailable === true,
      placedAt: str(hold.placedDate),
      expiresAt: str(hold.expireDate),
      suspendedUntil: hold.suspensionFlag === true ? str(hold.suspensionEnd) : null,
      coverUrl: cover(hold.covers),
    };
  });
  const loans = new Set((Array.isArray(body.loans) ? body.loans : []).map((raw) => {
    const loan = obj(raw);
    return `${str(loan.cardId) ?? (cards.length === 1 ? cards[0]!.cardId : "")}:${str(loan.id) ?? ""}`;
  }));
  return { cards, holds, loans };
}

const holdPath = (cardId: string, titleId: string) => `/card/${encodeURIComponent(cardId)}/hold/${encodeURIComponent(titleId)}`;

export async function placeHold(token: string, cardId: string, titleId: string): Promise<void> {
  await syncCall("place the hold", "POST", holdPath(cardId, titleId), { token, json: { days_to_suspend: 0, email_address: "" } });
}

export async function cancelHold(token: string, cardId: string, titleId: string): Promise<void> {
  await syncCall("cancel the hold", "DELETE", holdPath(cardId, titleId), { token });
}

/** Suspend a hold for `days`; 0 lifts the suspension. A suspended hold keeps moving up but cannot become ready. */
export async function suspendHold(token: string, cardId: string, titleId: string, days: number): Promise<void> {
  await syncCall("update the hold", "PUT", holdPath(cardId, titleId), { token, json: { days_to_suspend: days, email_address: "" } });
}

/** Borrow a ready hold, for the card's own default loan length. */
export async function borrowHold(token: string, card: LibbyCard, hold: LibbyHold): Promise<void> {
  const days = (hold.format ? card.loanDays[hold.format] : undefined) ?? DEFAULT_LOAN_DAYS;
  await syncCall("borrow the title", "POST", `/card/${encodeURIComponent(card.cardId)}/loan/${encodeURIComponent(hold.titleId)}`, {
    token, json: { period: days, units: "days", lucky_day: null, title_format: hold.format },
  });
}

/** Search one library's public catalog. Needs no sign-in. */
export async function searchCatalog(libraryKey: string, query: string): Promise<CatalogTitle[]> {
  const params = new URLSearchParams({ query, perPage: "12", page: "1" });
  const res = await fetchCapped(`${catalogOrigin()}/v2/libraries/${encodeURIComponent(libraryKey)}/media?${params}`, {
    headers: { accept: "application/json" }, maxBytes: MAX_RESPONSE_BYTES,
  });
  if (res.status !== 200) throw new LibbyError(`the library catalog answered HTTP ${res.status}`, res.status);
  const items = (JSON.parse(res.body) as { items?: unknown }).items;
  return (Array.isArray(items) ? items : []).flatMap((raw): CatalogTitle[] => {
    const item = obj(raw);
    const titleId = str(item.id);
    const title = str(item.title);
    if (!titleId || !title) return [];
    return [{
      titleId, title,
      author: str(item.firstCreatorName),
      format: str(obj(item.type).id),
      available: item.isAvailable === true,
      ownedCopies: num(item.ownedCopies),
      holdsCount: num(item.holdsCount),
      estimatedWaitDays: num(item.estimatedWaitDays),
      coverUrl: cover(item.covers),
    }];
  });
}
