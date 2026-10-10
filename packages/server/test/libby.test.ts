import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { diffHolds, type LibbySnapshot } from "../src/ingestors/libby.js";
import type { LibbyHold, LibbySync } from "../src/libby/client.js";

const DAY = 86_400_000;
const jwt = (expiresInMs: number, n: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + expiresInMs) / 1000), n })).toString("base64url")}.s`;

/** A stand-in for Libby's sync service and catalog, holding one account. */
interface FakeLibby {
  server: Server;
  baseUrl: string;
  code: string;
  /** Lifetime of the tokens it issues. */
  tokenLifeMs: number;
  linked: Set<string>;
  cards: Record<string, unknown>[];
  holds: Record<string, unknown>[];
  loans: Record<string, unknown>[];
  requests: { method: string; path: string; body: string }[];
}

async function startFakeLibby(): Promise<FakeLibby> {
  let issued = 0;
  const fake: FakeLibby = {
    server: null as unknown as Server, baseUrl: "", code: "12345678", tokenLifeMs: 7 * DAY, linked: new Set(), requests: [],
    cards: [{ cardId: "c1", cardName: "My card", advantageKey: "citylib", library: { name: "City Library" }, lendingPeriods: { audiobook: { preference: [14, "days"] } } }],
    holds: [], loans: [],
  };
  fake.server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://fake");
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      fake.requests.push({ method: req.method ?? "", path: url.pathname, body });
      const send = (status: number, json: unknown) => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json)); };
      const route = `${req.method} ${url.pathname}`;
      if (route === "POST /chip") {
        const identity = jwt(fake.tokenLifeMs, issued++);
        if (fake.linked.has(token)) fake.linked.add(identity);
        return send(200, { chip: "chip-1", identity, syncable: false, primary: true });
      }
      if (route === "POST /chip/clone/code") {
        if (new URLSearchParams(body).get("code") !== fake.code) return send(404, { result: "not_found" });
        const identity = jwt(fake.tokenLifeMs, issued++);
        fake.linked.add(identity);
        return send(200, { result: "cloned", chip: "chip-1", identity });
      }
      if (url.pathname.startsWith("/v2/libraries/citylib/media")) {
        return send(200, { items: [{ id: "t9", title: `About ${url.searchParams.get("query")}`, firstCreatorName: "A. Writer", type: { id: "ebook" }, isAvailable: false, ownedCopies: 2, holdsCount: 7 }, { title: "no id" }] });
      }
      if (!fake.linked.has(token)) return route === "GET /chip/sync" ? send(200, { result: "synchronized", cards: [] }) : send(401, { result: "unauthorized" });
      if (route === "GET /chip/sync") return send(200, { result: "synchronized", cards: fake.cards, holds: fake.holds, loans: fake.loans });
      const hold = /^\/card\/c1\/hold\/([^/]+)$/.exec(url.pathname);
      if (hold && req.method === "POST") {
        fake.holds.push({ id: hold[1], cardId: "c1", title: `Title ${hold[1]}`, type: { id: "ebook" }, holdListPosition: 7, holdsCount: 7, ownedCopies: 2, estimatedWaitDays: 21, isAvailable: false });
        return send(200, { id: hold[1] });
      }
      if (hold && req.method === "DELETE") {
        fake.holds = fake.holds.filter((h) => h.id !== hold[1]);
        return send(200, {});
      }
      if (hold && req.method === "PUT") {
        const days = (JSON.parse(body) as { days_to_suspend: number }).days_to_suspend;
        const target = fake.holds.find((h) => h.id === hold[1])!;
        target.suspensionFlag = days > 0;
        target.suspensionEnd = days > 0 ? new Date(Date.now() + days * DAY).toISOString() : null;
        return send(200, {});
      }
      const loan = /^\/card\/c1\/loan\/([^/]+)$/.exec(url.pathname);
      if (loan && req.method === "POST") {
        fake.holds = fake.holds.filter((h) => h.id !== loan[1]);
        fake.loans.push({ id: loan[1], cardId: "c1" });
        return send(200, { id: loan[1] });
      }
      return send(404, { result: "not_found" });
    });
  });
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  fake.baseUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  return fake;
}

const NOW = new Date("2026-10-20T12:00:00Z");

function hold(overrides: Partial<LibbyHold> = {}): LibbyHold {
  return {
    titleId: "t1", cardId: "c1", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", format: "audiobook",
    position: 34, holdsCount: 60, ownedCopies: 3, estimatedWaitDays: 14, ready: false,
    placedAt: null, expiresAt: null, suspendedUntil: null, coverUrl: null, ...overrides,
  };
}

function sync(holds: LibbyHold[], loans: string[] = []): LibbySync {
  return { cards: [{ cardId: "c1", library: "City Library", libraryKey: "citylib", loanDays: {} }], holds, loans: new Set(loans) };
}

describe("diffHolds", () => {
  /** Feed a sequence of syncs through the diff, returning the notice titles each one produced. */
  function run(steps: LibbySync[]): { titles: string[][]; ids: string[]; snapshot: LibbySnapshot | null } {
    let snapshot: LibbySnapshot | null = null;
    const titles: string[][] = [];
    const ids: string[] = [];
    for (const step of steps) {
      const result = diffHolds(snapshot, step, NOW);
      snapshot = result.snapshot;
      titles.push(result.items.map((i) => i.title!));
      ids.push(...result.items.map((i) => i.externalId));
    }
    return { titles, ids, snapshot };
  }

  it("announces a new hold once and then stays silent while nothing changes", () => {
    const first = diffHolds(null, sync([hold()]), NOW);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      externalId: "hold:c1:t1:1:placed",
      title: "Hold placed · The Left Hand of Darkness · #34 in queue",
      text: "Audiobook · City Library · you are #34 in the queue · 60 active holds · 3 copies · estimated available Nov 3 (~14 days)",
      url: "https://share.libbyapp.com/title/t1",
      author: "Ursula K. Le Guin",
    });
    expect(diffHolds(first.snapshot, sync([hold()]), NOW).items).toEqual([]);
  });

  it("reports queue movement only when it is worth reading", () => {
    const { titles } = run([
      sync([hold({ position: 34 })]),
      sync([hold({ position: 33 })]),
      sync([hold({ position: 31 })]),
      sync([hold({ position: 29 })]),
      sync([hold({ position: 30 })]),
      sync([hold({ position: 10 })]),
      sync([hold({ position: 9 })]),
    ]);
    expect(titles.slice(1)).toEqual([
      [], [],
      ["Moving up · The Left Hand of Darkness · #29, was #34"],
      [],
      ["Moving up · The Left Hand of Darkness · #10, was #29"],
      ["Moving up · The Left Hand of Darkness · #9, was #10"],
    ]);
  });

  it("announces ready, and tells borrowed from lapsed from cancelled", () => {
    const ready = hold({ position: 1, ready: true, expiresAt: "2026-11-06T00:00:00Z" });
    const borrowed = run([sync([hold({ position: 2 })]), sync([ready]), sync([], ["c1:t1"])]);
    expect(borrowed.titles.slice(1)).toEqual([["Ready now · The Left Hand of Darkness · borrow by Nov 6"], ["Borrowed · The Left Hand of Darkness"]]);
    expect(borrowed.snapshot!.holds).toEqual({});
    expect(run([sync([ready]), sync([])]).titles).toEqual([["Ready now · The Left Hand of Darkness · borrow by Nov 6"], ["Hold ended · The Left Hand of Darkness"]]);
    expect(run([sync([hold()]), sync([])]).titles[1]).toEqual(["Hold cancelled · The Left Hand of Darkness"]);
  });

  it("announces a suspension and its end, and never reuses a notice id", () => {
    const suspended = hold({ suspendedUntil: "2026-11-20T00:00:00Z" });
    const { titles, ids } = run([sync([hold()]), sync([suspended]), sync([suspended]), sync([hold()]), sync([suspended]), sync([])]);
    expect(titles.slice(1, 4)).toEqual([["Hold suspended · The Left Hand of Darkness · until Nov 20"], [], ["Hold resumed · The Left Hand of Darkness · #34 in queue"]]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it("leaves out details Libby did not send instead of inventing them", () => {
    const bare = hold({ position: null, holdsCount: null, ownedCopies: null, estimatedWaitDays: null, format: null });
    const { items } = diffHolds(null, sync([bare]), NOW);
    expect(items[0]).toMatchObject({ title: "Hold placed · The Left Hand of Darkness", text: "City Library" });
  });
});

describe("libby api", () => {
  let app: FastifyInstance;
  let fake: FakeLibby;

  beforeEach(async () => {
    fake = await startFakeLibby();
    process.env.READER_LIBBY_URL = fake.baseUrl;
    process.env.READER_LIBBY_CATALOG_URL = fake.baseUrl;
    app = await createServer({ dbPath: ":memory:", poller: false, llm: null });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await new Promise((r) => fake.server.close(r));
    delete process.env.READER_LIBBY_URL;
    delete process.env.READER_LIBBY_CATALOG_URL;
  });

  const libby = (method: "GET" | "POST" | "DELETE", path = "", payload?: object) =>
    app.inject({ method, url: `/api/v1/libby${path}`, ...(payload ? { payload } : {}) });
  const link = (code = fake.code) => libby("POST", "/link", { code });
  const notices = async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/articles?feed_kind=library&order=oldest" });
    return (res.json().articles as { title: string }[]).map((a) => a.title);
  };
  const queued = (id: string, extra: object = {}) =>
    ({ id, cardId: "c1", title: `Title ${id}`, firstCreatorName: "A. Writer", type: { id: "audiobook" }, holdListPosition: 12, holdsCount: 30, ownedCopies: 2, estimatedWaitDays: 20, isAvailable: false, ...extra });

  it("links an account from a setup code and turns its queue into a feed", async () => {
    fake.holds = [queued("t1"), queued("t2", { holdListPosition: 1, isAvailable: true, expireDate: "2026-11-06T00:00:00Z" })];
    expect((await libby("GET")).json()).toEqual({ linked: false });

    const linked = await link("1234 5678");
    expect(linked.statusCode).toBe(200);
    const state = linked.json();
    expect(state).toMatchObject({ linked: true, needsRelink: false, lastError: null, cards: [{ cardId: "c1", library: "City Library", libraryKey: "citylib" }] });
    expect(state.holds.map((h: { titleId: string; ready: boolean; position: number }) => [h.titleId, h.ready, h.position])).toEqual([["t2", true, 1], ["t1", false, 12]]);
    expect(Date.parse(state.signInExpiresAt)).toBeGreaterThan(Date.now() + 6 * DAY);

    expect(await notices()).toEqual(expect.arrayContaining(["Hold placed · Title t1 · #12 in queue", "Ready now · Title t2 · borrow by Nov 6"]));
    const feeds = (await app.inject({ method: "GET", url: "/api/v1/feeds" })).json().feeds;
    expect(feeds).toEqual([expect.objectContaining({ id: state.feedId, title: "Libby holds", kind: "library", unreadCount: 2 })]);

    // The sign-in token stays on the server: no API answer carries it.
    const token = [...fake.linked][0]!;
    for (const url of ["/api/v1/libby", "/api/v1/credentials", "/api/v1/ingestors", "/api/v1/feeds"]) {
      expect((await app.inject({ method: "GET", url })).body, url).not.toContain(token);
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/credentials" })).json().credentials[0]).toMatchObject({ provider: "libby", label: "City Library" });
  });

  it("refuses a malformed or rejected setup code without leaving an account behind", async () => {
    expect((await link("1234")).statusCode).toBe(400);
    const rejected = await link("00000000");
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("libby_code_rejected");
    expect((await libby("GET")).json()).toEqual({ linked: false });
    expect((await libby("POST", "/sync")).statusCode).toBe(404);

    // A code that signs in but carries no library card is not a usable account.
    fake.cards = [];
    expect((await link()).statusCode).toBe(502);
    expect((await libby("GET")).json()).toEqual({ linked: false });
  });

  it("places, suspends, resumes, cancels and borrows holds, re-syncing after each", async () => {
    fake.holds = [queued("t1"), queued("t2", { holdListPosition: 1, isAvailable: true })];
    await link();

    const found = (await libby("GET", "/search?q=dune")).json();
    expect(found).toMatchObject({ cardId: "c1", library: "City Library", titles: [{ titleId: "t9", title: "About dune", format: "ebook", available: false, holdsCount: 7 }] });
    expect((await libby("GET", "/search?q=d")).statusCode).toBe(400);

    const placed = await libby("POST", "/holds", { cardId: "c1", titleId: "t9" });
    expect(placed.json().holds.map((h: { titleId: string }) => h.titleId)).toEqual(["t2", "t9", "t1"]);
    expect((await libby("POST", "/holds", { cardId: "c1", titleId: "t9" })).statusCode).toBe(409);
    expect((await libby("POST", "/holds", { cardId: "nope", titleId: "t8" })).statusCode).toBe(404);

    const suspended = await libby("POST", "/holds/c1/t1/suspend", { days: 14 });
    expect(suspended.json().holds.find((h: { titleId: string }) => h.titleId === "t1").suspendedUntil).not.toBeNull();
    const resumed = await libby("POST", "/holds/c1/t1/suspend", { days: 0 });
    expect(resumed.json().holds.find((h: { titleId: string }) => h.titleId === "t1").suspendedUntil).toBeNull();
    expect((await libby("POST", "/holds/c1/t1/suspend", { days: 999 })).statusCode).toBe(400);

    expect((await libby("POST", "/holds/c1/t1/borrow")).json().error.code).toBe("hold_not_ready");
    const borrowed = await libby("POST", "/holds/c1/t2/borrow");
    expect(borrowed.statusCode).toBe(200);
    // The card's own lending period for the format, not a guess.
    expect(JSON.parse(fake.requests.find((r) => r.path === "/card/c1/loan/t2")!.body)).toEqual({ period: 14, units: "days", lucky_day: null, title_format: "audiobook" });

    const cancelled = await libby("DELETE", "/holds/c1/t1");
    expect(cancelled.json().holds.map((h: { titleId: string }) => h.titleId)).toEqual(["t9"]);
    expect((await libby("DELETE", "/holds/c1/t1")).statusCode).toBe(404);

    expect((await notices()).slice(2)).toEqual([
      "Hold placed · Title t9 · #7 in queue",
      expect.stringMatching(/^Hold suspended · Title t1 · until /),
      "Hold resumed · Title t1 · #12 in queue",
      "Borrowed · Title t2",
      "Hold cancelled · Title t1",
    ]);
  });

  it("renews a sign-in that is close to lapsing and keeps syncing", async () => {
    fake.tokenLifeMs = 2 * DAY;
    fake.holds = [queued("t1")];
    const first = (await link()).json();
    fake.tokenLifeMs = 7 * DAY;

    const synced = await libby("POST", "/sync");
    expect(synced.statusCode).toBe(200);
    expect(Date.parse(synced.json().signInExpiresAt)).toBeGreaterThan(Date.parse(first.signInExpiresAt) + 4 * DAY);
    // One anonymous device at link time, then a renewal on each sync while the token stayed short-lived.
    expect(fake.requests.filter((r) => r.path === "/chip")).toHaveLength(3);
    await libby("POST", "/sync");
    expect(fake.requests.filter((r) => r.path === "/chip")).toHaveLength(3);
  });

  it("reports a dead sign-in as needing a re-link, and a re-link keeps the history", async () => {
    fake.holds = [queued("t1")];
    await link();
    fake.linked.clear();

    const failed = await libby("POST", "/sync");
    expect(failed.statusCode).toBe(502);
    // Losing the cards is a failed sync, never a queue of cancelled holds.
    expect(failed.json().libby).toMatchObject({ lastError: expect.stringMatching(/link the account again/), holds: [expect.objectContaining({ titleId: "t1" })] });
    expect(await notices()).toEqual(["Hold placed · Title t1 · #12 in queue"]);

    fake.holds = [queued("t1", { holdListPosition: 3 })];
    const relinked = await link();
    expect(relinked.json()).toMatchObject({ lastError: null, holds: [expect.objectContaining({ position: 3 })] });
    expect(await notices()).toEqual(["Hold placed · Title t1 · #12 in queue", "Moving up · Title t1 · #3, was #12"]);
    expect((await app.inject({ method: "GET", url: "/api/v1/credentials" })).json().credentials).toHaveLength(1);
  });

  it("answers an expired sign-in with a re-link request before calling Libby", async () => {
    fake.tokenLifeMs = -DAY;
    fake.holds = [queued("t1")];
    const linked = await link();
    expect(linked.statusCode).toBe(502);
    expect(linked.json().libby.needsRelink).toBe(true);
    const before = fake.requests.length;
    const change = await libby("POST", "/holds", { cardId: "c1", titleId: "t9" });
    expect(change.statusCode).toBe(409);
    expect(fake.requests).toHaveLength(before);
  });

  it("unlinks the account, its feed and its sign-in together", async () => {
    await link();
    expect((await libby("DELETE")).statusCode).toBe(204);
    expect((await libby("GET")).json()).toEqual({ linked: false });
    expect((await app.inject({ method: "GET", url: "/api/v1/feeds" })).json().feeds).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/v1/credentials" })).json().credentials).toEqual([]);
    expect((await libby("DELETE")).statusCode).toBe(404);
  });
});
