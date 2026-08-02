import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureFeed {
  xml: string;
  rawBody?: string;
  etag?: string;
  lastModified?: string;
  statusOnRequest?: number;
  requestCount: number;
}

export async function startFixtureServer(feeds: Record<string, Omit<FixtureFeed, "requestCount">>): Promise<{ server: Server; baseUrl: string; state: Map<string, FixtureFeed> }> {
  const state = new Map<string, FixtureFeed>(
    Object.entries(feeds).map(([k, v]) => [k, { ...v, requestCount: 0 }]),
  );
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const feed = state.get(path);
    if (!feed) { res.writeHead(404).end(); return; }
    feed.requestCount++;
    if (feed.statusOnRequest) { res.writeHead(feed.statusOnRequest).end(); return; }
    if (feed.etag && req.headers["if-none-match"] === feed.etag) {
      res.writeHead(304).end(); return;
    }
    if (feed.lastModified && req.headers["if-modified-since"] === feed.lastModified) {
      res.writeHead(304).end(); return;
    }
    res.writeHead(200, {
      "content-type": "application/rss+xml",
      ...(feed.etag ? { etag: feed.etag } : {}),
      ...(feed.lastModified ? { "last-modified": feed.lastModified } : {}),
    });
    res.end(feed.rawBody ?? feed.xml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, state };
}
