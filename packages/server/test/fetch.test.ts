import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchCapped } from "../src/fetch.js";

const servers: Server[] = [];

async function start(handler: (url: string, auth: string | undefined, res: import("node:http").ServerResponse, body: string) => void): Promise<string> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => handler(req.url ?? "/", req.headers.authorization, res, body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("fetchCapped", () => {
  it("keeps authorization on same-origin redirects and drops it cross-origin", async () => {
    const other = await start((_url, auth, res) => res.end(auth ?? "none"));
    const origin = await start((url, auth, res) => {
      if (url === "/same") { res.writeHead(302, { location: "/echo" }).end(); return; }
      if (url === "/cross") { res.writeHead(302, { location: `${other}/echo` }).end(); return; }
      res.end(auth ?? "none");
    });
    const headers = { authorization: "Bearer secret" };
    expect((await fetchCapped(`${origin}/same`, { headers })).body).toBe("Bearer secret");
    expect((await fetchCapped(`${origin}/cross`, { headers })).body).toBe("none");
  });

  it("posts a form body and refuses to follow a redirect on a non-GET", async () => {
    const origin = await start((url, _auth, res, body) => {
      if (url === "/moved") { res.writeHead(307, { location: "/token" }).end(); return; }
      res.end(body);
    });
    const res = await fetchCapped(`${origin}/token`, { method: "POST", body: "a=1&b=2" });
    expect(res.body).toBe("a=1&b=2");
    await expect(fetchCapped(`${origin}/moved`, { method: "POST", body: "x" })).rejects.toThrow(/redirect/);
  });
});
