import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer as createHttpServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsClient } from "ws";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import { Poller } from "../src/poller/poller.js";
import { IngestorEngine } from "../src/ingestors/engine.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import { streamingTokenFor } from "../src/auth/credentials.js";
import { jetstreamPost, jetstreamUrl } from "../src/realtime/jetstream.js";

let storage: Storage;
let userId: string;
let http: Server;
let httpBase: string;
let routes: Record<string, unknown>;
let wss: WebSocketServer;
let wsBase: string;
let clients: { socket: WsClient; req: IncomingMessage }[];
let hub: RealtimeHub | null;

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeEach(async () => {
  storage = createSqliteStorage(":memory:");
  userId = storage.getOrCreateLocalUser().id;
  routes = {};
  http = createHttpServer((req, res) => {
    const body = routes[new URL(req.url ?? "/", "http://x").pathname];
    if (body === undefined) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  httpBase = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  clients = [];
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (socket, req) => clients.push({ socket, req }));
  await new Promise<void>((r) => wss.once("listening", () => r()));
  wsBase = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  hub = null;
});

afterEach(async () => {
  hub?.stop();
  await new Promise((r) => wss.close(r));
  await new Promise((r) => http.close(r));
  storage.close();
});

function ingestor(kind: "mastodon" | "bluesky", config: Record<string, unknown>) {
  const feed = storage.createFeed(userId, { url: `ingestor://${kind}/${Math.random()}`, title: kind, siteUrl: null });
  const ing = storage.createIngestor(userId, { kind, config, feedId: feed.id });
  storage.updateIngestor(ing.id, { llmEnabled: false });
  return storage.getIngestor(ing.id)!;
}

const makeHub = (opts: Partial<ConstructorParameters<typeof RealtimeHub>[3]>) =>
  new RealtimeHub(storage, new Poller(storage), new IngestorEngine(storage, null), {
    podpingUrl: null, jetstreamUrl: null, mastodonStreaming: false, streamBatchMs: 20, ...opts,
  });

describe("Mastodon streaming", () => {
  it("streams the home timeline with the token in Sec-WebSocket-Protocol and delivers statuses", async () => {
    routes["/api/v2/instance"] = { configuration: { urls: { streaming: wsBase } } };
    const cred = storage.createCredential(userId, {
      provider: "mastodon", label: "@ann@local", origin: httpBase,
      secret: { kind: "oauth2", tokenUrl: `${httpBase}/oauth/token`, clientId: "c", clientSecret: "s", accessToken: "stream-token", refreshToken: null, expiresAt: null },
    });
    const ing = ingestor("mastodon", { instance: new URL(httpBase).host, timeline: "home", credentialId: cred.id, _baseUrl: httpBase });
    hub = makeHub({ mastodonStreaming: true });
    await hub.reconcile();
    await until(() => clients.length === 1);
    const { socket, req } = clients[0]!;
    expect(req.url).toBe("/api/v1/streaming?stream=user");
    expect(req.headers["sec-websocket-protocol"]).toBe("stream-token");

    const status = { id: "9001", created_at: "2026-09-10T12:00:00Z", url: "https://local/@bob/9001", content: "<p>live post</p>", account: { acct: "bob" } };
    socket.send(JSON.stringify({ stream: ["user"], event: "notification", payload: "{}" }));
    socket.send(JSON.stringify({ stream: ["user"], event: "update", payload: JSON.stringify(status) }));
    await until(() => storage.listArticles({ userId, feedId: ing.feedId, limit: 10 }).length === 1);
    const [article] = storage.listArticles({ userId, feedId: ing.feedId, limit: 10, includeContent: true });
    expect(article!.url).toBe("https://local/@bob/9001");
    expect(hub.status().mastodon).toEqual({ enabled: true, streams: 1 });

    storage.deleteIngestor(ing.id);
    await hub.reconcile();
    expect(hub.status().mastodon.streams).toBe(0);
  });

  it("never hands a token to a stream host outside the credential's site", async () => {
    const cred = storage.createCredential(userId, {
      provider: "mastodon", label: "@ann@social.example", origin: "https://social.example",
      secret: { kind: "bearer", token: "t" },
    });
    await expect(streamingTokenFor(storage, cred.id, "wss://streaming.social.example/api/v1/streaming")).resolves.toBe("t");
    await expect(streamingTokenFor(storage, cred.id, "wss://evil.example/api/v1/streaming")).rejects.toThrow(/not stream/);
    await expect(streamingTokenFor(storage, cred.id, "wss://social.example.evil.example/")).rejects.toThrow(/not stream/);
    await expect(streamingTokenFor(storage, cred.id, "ws://social.example/")).rejects.toThrow(/not stream/);
  });
});

describe("Bluesky Jetstream", () => {
  it("builds a filtered, resumable subscription and reads only new posts", () => {
    const url = new URL(jetstreamUrl("wss://jet.example/subscribe", ["did:plc:a", "did:plc:b"], 10_000_000));
    expect(url.searchParams.getAll("wantedDids")).toEqual(["did:plc:a", "did:plc:b"]);
    expect(url.searchParams.get("wantedCollections")).toBe("app.bsky.feed.post");
    expect(url.searchParams.get("cursor")).toBe("5000000");
    const commit = (operation: string, collection = "app.bsky.feed.post") => JSON.stringify({
      did: "did:plc:a", time_us: 1, kind: "commit", commit: { operation, collection, rkey: "3k", record: { text: "hi", createdAt: "2026-09-10T00:00:00Z" } },
    });
    expect(jetstreamPost(commit("create"))).toEqual({ did: "did:plc:a", timeUs: 1, rkey: "3k", text: "hi", createdAt: "2026-09-10T00:00:00Z" });
    expect(jetstreamPost(commit("delete"))).toBeNull();
    expect(jetstreamPost(commit("create", "app.bsky.feed.like"))).toBeNull();
  });

  it("follows handle ingestors in one socket and delivers their posts like polled ones", async () => {
    routes["/xrpc/com.atproto.identity.resolveHandle"] = { did: "did:plc:ann" };
    const ing = ingestor("bluesky", { handle: "ann.bsky.social" });
    ingestor("bluesky", { search: "not streamable" });
    hub = makeHub({ jetstreamUrl: `${wsBase}/subscribe`, bskyApiBase: httpBase });
    await hub.reconcile();
    await until(() => clients.length === 1);
    const query = new URL(clients[0]!.req.url!, "ws://x").searchParams;
    expect(query.getAll("wantedDids")).toEqual(["did:plc:ann"]);
    clients[0]!.socket.send(JSON.stringify({
      did: "did:plc:ann", time_us: 1_789_000_000_000_000, kind: "commit",
      commit: { operation: "create", collection: "app.bsky.feed.post", rkey: "3kxyz", record: { text: "streamed hello", createdAt: "2026-09-10T12:00:00Z" } },
    }));
    await until(() => storage.listArticles({ userId, feedId: ing.feedId, limit: 10 }).length === 1);
    const [article] = storage.listArticles({ userId, feedId: ing.feedId, limit: 10 });
    expect(article!.url).toBe("https://bsky.app/profile/ann.bsky.social/post/3kxyz");
    expect(hub.status().jetstream).toEqual({ enabled: true, accounts: 1 });
  });
});
