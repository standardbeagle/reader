import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsClient } from "ws";
import { createSqliteStorage } from "../src/storage/sqlite.js";
import type { Storage } from "../src/storage/types.js";
import { Poller } from "../src/poller/poller.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import { feedKey, podpingIris } from "../src/realtime/podping.js";
import { startFixtureServer, type FixtureFeed } from "./fixtureServer.js";

const frame = (iris: string[]) => JSON.stringify({ a: "https://api.hive.blog", n: 1, p: [{ a: "podping.x", i: "pp_podcast_update", p: { iris, medium: "podcast", reason: "update" } }], t: "podping", v: 2 });

describe("podping frames", () => {
  it("extracts updated feed IRIs and ignores anything else", () => {
    expect(podpingIris(frame(["https://a.example/feed.xml", "https://b.example/rss"]))).toEqual(["https://a.example/feed.xml", "https://b.example/rss"]);
    expect(podpingIris(JSON.stringify({ t: "other", p: [] }))).toEqual([]);
    expect(podpingIris("not json")).toEqual([]);
  });

  it("matches feed URLs across scheme, host case and trailing slash", () => {
    expect(feedKey("http://Pod.Example.com/feed/")).toBe(feedKey("https://pod.example.com/feed"));
    expect(feedKey("https://pod.example.com/feed?id=1")).not.toBe(feedKey("https://pod.example.com/feed?id=2"));
  });
});

describe("RealtimeHub podping", () => {
  let storage: Storage;
  let fixture: Server;
  let baseUrl: string;
  let state: Map<string, FixtureFeed>;
  let relay: WebSocketServer;
  let relayUrl: string;
  let clients: WsClient[];
  let hub: RealtimeHub | null;

  const EP = (base: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Pod</title><link>${base}/</link>
    <item><title>Ep</title><guid>e1</guid><enclosure url="${base}/e1.mp3" type="audio/mpeg"/></item></channel></rss>`;

  beforeEach(async () => {
    storage = createSqliteStorage(":memory:");
    ({ server: fixture, baseUrl, state } = await startFixtureServer({ "/pod.xml": { xml: "" }, "/blog.xml": { xml: "" } }));
    state.get("/pod.xml")!.xml = EP(baseUrl);
    state.get("/blog.xml")!.xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><item><title>P</title><guid>p1</guid></item></channel></rss>`;
    clients = [];
    relay = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    relay.on("connection", (c) => clients.push(c));
    await new Promise<void>((r) => relay.once("listening", () => r()));
    relayUrl = `ws://127.0.0.1:${(relay.address() as AddressInfo).port}`;
    hub = null;
  });

  afterEach(async () => {
    hub?.stop();
    await new Promise((r) => relay.close(r));
    storage.close();
    await new Promise((r) => fixture.close(r));
  });

  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error("condition not met");
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it("connects only when a podcast is subscribed, and refreshes the feeds it names", async () => {
    const user = storage.getOrCreateLocalUser();
    const poller = new Poller(storage);
    const blog = storage.createFeed(user.id, { url: `${baseUrl}/blog.xml`, title: "b", siteUrl: null });
    await poller.refreshFeed(blog.id);
    hub = new RealtimeHub(storage, poller, { podpingUrl: relayUrl, reconcileMs: 60_000 });
    hub.start();
    expect(hub.status().streams).toHaveLength(0);

    const pod = storage.createFeed(user.id, { url: `${baseUrl}/pod.xml`, title: "p", siteUrl: null });
    await poller.refreshFeed(pod.id);
    hub.reconcile();
    await until(() => clients.length === 1 && hub!.status().streams[0]?.state === "open");

    const before = { pod: state.get("/pod.xml")!.requestCount, blog: state.get("/blog.xml")!.requestCount };
    clients[0]!.send(frame([`${baseUrl}/pod.xml/`, `${baseUrl}/blog.xml`, "https://unrelated.example/feed"]));
    await until(() => state.get("/pod.xml")!.requestCount === before.pod + 1);
    // Blog is subscribed but has no episodes, so it is not a podcast feed and is left to polling.
    expect(state.get("/blog.xml")!.requestCount).toBe(before.blog);
    // A second ping inside the minimum refresh window does not refetch.
    clients[0]!.send(frame([`${baseUrl}/pod.xml`]));
    await new Promise((r) => setTimeout(r, 100));
    expect(state.get("/pod.xml")!.requestCount).toBe(before.pod + 1);
    expect(hub.status().podping).toEqual({ enabled: true, watchedFeeds: 1, matches: 1 });

    storage.deleteFeed(pod.id);
    hub.reconcile();
    expect(hub.status().streams).toHaveLength(0);
  });
});
