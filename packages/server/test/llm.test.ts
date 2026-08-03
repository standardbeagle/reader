import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenRouterClient } from "../src/llm/client.js";
import { processItems } from "../src/llm/pipeline.js";
import type { NormalizedItem } from "../src/storage/types.js";

let server: Server;
let baseUrl: string;
let lastBody: string;

async function start(responder: (body: string) => unknown) {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      lastBody = data;
      const raw = responder(data);
      const content = typeof raw === "string" ? raw : JSON.stringify(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
afterEach(async () => { await new Promise((r) => server.close(r)); });

const items: NormalizedItem[] = [
  { externalId: "a", author: "x", title: "You won't BELIEVE this", text: "clickbait garbage", url: null, publishedAt: null },
  { externalId: "b", author: "y", title: "Postgres 17 released", text: "New logical replication features and json table improvements.", url: null, publishedAt: null },
];

describe("openrouter client + pipeline", () => {
  it("filterBatch sends items and parses scores", async () => {
    await start(() => [
      { id: "a", score: 1, reason: "pure clickbait" },
      { id: "b", score: 9, reason: "substantive release news" },
    ]);
    const llm = createOpenRouterClient({ apiKey: "test-key", baseUrl, model: "test-model" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.dropped.map((d) => d.item.externalId)).toEqual(["a"]);
    expect(result.kept.map((k) => k.item.externalId)).toEqual(["b"]);
    const sent = JSON.parse(lastBody);
    expect(sent.model).toBe("test-model");
    expect(sent.messages).toHaveLength(2);
  });

  it("summarizeBatch rewrites kept items", async () => {
    let call = 0;
    await start(() => {
      call++;
      if (call === 1) return [{ id: "a", score: 8, reason: "ok" }, { id: "b", score: 9, reason: "ok" }];
      return [
        { id: "a", title: "Believe this", summary: "A factual rewrite." },
        { id: "b", title: "Postgres 17 released", summary: "Postgres 17 adds logical replication upgrades." },
      ];
    });
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.kept[0]!.title).toBe("Believe this");
    expect(result.kept[1]!.summary).toContain("logical replication");
    expect(result.kept[0]!.score).toBe(8);
  });

  it("extracts json from prose-wrapped responses", async () => {
    await start(() => "Here are the scores: [{\"id\":\"a\",\"score\":2,\"reason\":\"bait\"},{\"id\":\"b\",\"score\":8,\"reason\":\"good\"}] hope this helps");
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    const result = await processItems(items, { llm, threshold: 5 });
    expect(result.kept.map((k) => k.item.externalId)).toEqual(["b"]);
  });

  it("throws (fails closed) on malformed llm output", async () => {
    await start(() => "no json here at all");
    const llm = createOpenRouterClient({ apiKey: "k", baseUrl, model: "m" });
    await expect(processItems(items, { llm, threshold: 5 })).rejects.toThrow(/llm/i);
  });

  it("raw passthrough when llm is null", async () => {
    const result = await processItems(items, { llm: null, threshold: 5 });
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.kept[0]!.title).toBe("You won't BELIEVE this");
  });
});
