import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsClient } from "ws";
import { ReconnectingSocket } from "../src/realtime/socket.js";

/**
 * A peer can vanish without sending a close frame — a dropped NAT mapping, a
 * load balancer that stops forwarding, a machine that loses power. TCP does
 * not notice, so `close` never fires and the socket sits at state "open"
 * forever while no events arrive. Traffic cannot distinguish that from a
 * genuinely quiet stream (Podping is silent for hours on a small watch list),
 * so liveness is answered at the protocol level: a ping that earns no pong
 * inside the deadline means the peer is gone.
 *
 * `autoPong: false` is what makes the first case reachable in a test — the
 * server completes the handshake and holds the connection open, but never
 * answers a ping, exactly as a black-holed peer does.
 */
describe("ReconnectingSocket liveness", () => {
  let servers: WebSocketServer[] = [];
  let sockets: ReconnectingSocket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets = [];
    for (const wss of servers) await new Promise((r) => wss.close(r));
    servers = [];
  });

  const start = async (autoPong: boolean) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", autoPong });
    servers.push(wss);
    const conns: WsClient[] = [];
    wss.on("connection", (c) => conns.push(c));
    await new Promise<void>((r) => wss.once("listening", () => r()));
    return { conns, url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}` };
  };

  const until = async (cond: () => boolean, ms = 5000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error("condition not met");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("reconnects when the peer stops answering pings without closing", async () => {
    const { conns, url } = await start(false);
    const sock = new ReconnectingSocket({
      name: "dead-peer",
      url: () => url,
      onMessage: () => {},
      pingIntervalMs: 40,
      pongTimeoutMs: 40,
    });
    sockets.push(sock);

    await until(() => conns.length >= 2);
    expect(conns.length).toBeGreaterThanOrEqual(2);
    expect(sock.status.pongTimeouts).toBeGreaterThan(0);
  });

  it("leaves a quiet peer alone while it still answers pings", async () => {
    // The false-positive guard on the test above: a stream that sends no
    // messages for many ping cycles must NOT be torn down, or a quiet Podping
    // relay reconnects forever.
    const { conns, url } = await start(true);
    const sock = new ReconnectingSocket({
      name: "quiet-peer",
      url: () => url,
      onMessage: () => {},
      pingIntervalMs: 25,
      pongTimeoutMs: 200,
    });
    sockets.push(sock);

    await until(() => sock.status.state === "open");
    await new Promise((r) => setTimeout(r, 500)); // ~20 ping cycles, zero traffic

    expect(sock.status.state).toBe("open");
    expect(conns.length).toBe(1);
    expect(sock.status.reconnects).toBe(0);
    expect(sock.status.pongTimeouts).toBe(0);
  });
});
