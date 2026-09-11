import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server.js";
import { startFixtureServer } from "./fixtureServer.js";

let app: FastifyInstance;
let fixture: Server;
let baseUrl: string;

const podcast = (base: string) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Pod</title><link>${base}/</link>
<item><title>Ep 1</title><guid>ep1</guid><pubDate>Wed, 01 Jul 2026 12:00:00 GMT</pubDate>
<enclosure url="${base}/ep1.mp3" type="audio/mpeg" length="1"/>
<podcast:transcript url="${base}/ep1.vtt" type="text/vtt"/>
<podcast:chapters url="/ep1-chapters.json" type="application/json+chapters"/>
</item>
<item><title>Ep 0</title><guid>ep0</guid><pubDate>Tue, 30 Jun 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(async () => {
  ({ server: fixture, baseUrl } = await startFixtureServer({
    "/pod.xml": { xml: "" },
    "/ep1.vtt": { xml: "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nHello listeners\n", contentType: "text/vtt" },
    "/ep1-chapters.json": { xml: JSON.stringify({ version: "1.2.0", chapters: [{ startTime: 0, title: "Intro" }, { startTime: 60, title: "Main" }] }), contentType: "application/json" },
  }));
  app = await createServer({ dbPath: ":memory:", poller: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await new Promise((r) => fixture.close(r));
});

describe("podcast episodes", () => {
  it("stores the enclosure as media and serves normalized transcript and chapters", async () => {
    const started = await startFixtureServer({ "/pod.xml": { xml: podcast(baseUrl) } });
    try {
      const sub = await app.inject({ method: "POST", url: "/api/v1/feeds", payload: { url: `${started.baseUrl}/pod.xml` } });
      expect(sub.statusCode).toBe(201);
      const list = (await app.inject({ method: "GET", url: "/api/v1/articles" })).json().articles;
      const ep1 = list.find((a: { title: string }) => a.title === "Ep 1");
      expect(ep1.media).toEqual({ url: `${baseUrl}/ep1.mp3`, type: "audio/mpeg" });
      expect(ep1.imageUrl).toBeNull();

      const full = (await app.inject({ method: "GET", url: `/api/v1/articles/${ep1.id}` })).json();
      expect(full.transcript).toEqual({ url: `${baseUrl}/ep1.vtt`, type: "text/vtt" });
      // Relative links resolve against the channel <link>, where the files live.
      expect(full.chaptersUrl).toBe(`${baseUrl}/ep1-chapters.json`);

      const transcript = await app.inject({ method: "GET", url: `/api/v1/articles/${ep1.id}/transcript` });
      expect(transcript.json()).toEqual({ kind: "cues", cues: [{ start: 5, text: "Hello listeners", speaker: null }] });

      const chapters = await app.inject({ method: "GET", url: `/api/v1/articles/${ep1.id}/chapters` });
      expect(chapters.json()).toEqual({ chapters: [
        { start: 0, title: "Intro", url: null, img: null },
        { start: 60, title: "Main", url: null, img: null },
      ] });

      const ep0 = list.find((a: { title: string }) => a.title === "Ep 0");
      expect((await app.inject({ method: "GET", url: `/api/v1/articles/${ep0.id}/transcript` })).statusCode).toBe(404);
    } finally {
      await new Promise((r) => started.server.close(r));
    }
  });
});

describe("migration 0011", () => {
  it("moves audio stored as an article image into media_url", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { default: Database } = await import("better-sqlite3");
    const { createSqliteStorage } = await import("../src/storage/sqlite.js");
    const { sanitizeHtml } = await import("@reader/core");
    const dir = mkdtempSync(join(tmpdir(), "reader-mig11-"));
    const path = join(dir, "reader.db");
    try {
      const before = createSqliteStorage(path);
      const feed = before.createFeed(before.getOrCreateLocalUser().id, { url: "https://pod.example.com/feed", title: "P", siteUrl: null });
      before.upsertArticles(feed.id, [
        { guid: "a", url: null, title: "Audio", author: null, publishedAt: null, contentHtml: null, summary: null, imageUrl: "https://cdn.example.com/ep.MP3?x=1" },
        { guid: "b", url: null, title: "Image", author: null, publishedAt: null, contentHtml: null, summary: null, imageUrl: "https://cdn.example.com/cover.jpg" },
      ], sanitizeHtml);
      before.close();
      const raw = new Database(path);
      raw.prepare("UPDATE articles SET media_url = NULL").run();
      raw.prepare("DELETE FROM schema_migrations WHERE name = ?").run("0011_article_media.sql");
      raw.exec("ALTER TABLE articles DROP COLUMN media_url; ALTER TABLE articles DROP COLUMN media_type; ALTER TABLE articles DROP COLUMN transcript_url; ALTER TABLE articles DROP COLUMN transcript_type; ALTER TABLE articles DROP COLUMN chapters_url;");
      raw.close();
      const reopened = createSqliteStorage(path);
      const rows = reopened.listArticles({ userId: reopened.getOrCreateLocalUser().id, limit: 10, includeContent: true });
      const audio = rows.find((r) => r.guid === "a")!;
      const image = rows.find((r) => r.guid === "b")!;
      expect(audio.imageUrl).toBeNull();
      expect(audio.media).toEqual({ url: "https://cdn.example.com/ep.MP3?x=1", type: null });
      expect(image.imageUrl).toBe("https://cdn.example.com/cover.jpg");
      expect(image.media).toBeNull();
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
