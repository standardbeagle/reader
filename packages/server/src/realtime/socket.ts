import WebSocket from "ws";
import { assertPublicUrl } from "../net-guard.js";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Frames above this are dropped unparsed; every stream we read sends small JSON. */
export const MAX_FRAME_CHARS = 256 * 1024;
/** How often an open socket proves its peer is still there. */
const PING_INTERVAL_MS = 30_000;
/** A ping unanswered for this long means the peer is gone, not slow. */
const PONG_TIMEOUT_MS = 10_000;

export interface SocketStatus {
  name: string;
  url: string;
  state: "connecting" | "open" | "waiting" | "closed";
  connectedAt: string | null;
  lastMessageAt: string | null;
  messages: number;
  reconnects: number;
  /** Times a ping went unanswered and the connection was torn down as dead. */
  pongTimeouts: number;
  lastError: string | null;
}

/**
 * An outbound WebSocket that reconnects with exponential backoff until
 * closed. The URL goes through the SSRF guard on every connect, like HTTP
 * fetches do, and oversized frames are dropped before parsing. `url` is a
 * function so a reconnect can resume from a cursor.
 *
 * LIVENESS IS PROTOCOL-LEVEL, NOT TRAFFIC-LEVEL. A peer can vanish without a
 * close frame — a dropped NAT mapping, a load balancer that stops forwarding,
 * a machine that loses power. TCP does not notice, so `close` never fires and
 * the socket sits at state "open" forever while nothing arrives. Silence
 * cannot tell that apart from a stream that simply has nothing to say
 * (Podping is quiet for hours on a small watch list), so an idle timer over
 * `lastMessageAt` would either tear down healthy quiet streams or take hours
 * to notice a dead one. A ping that earns no pong inside the deadline answers
 * the question without needing traffic. That is also why this uses the `ws`
 * client rather than the global WHATWG WebSocket, which exposes no ping/pong
 * to callers.
 */
export class ReconnectingSocket {
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private backoff = MIN_BACKOFF_MS;
  private closed = false;
  readonly status: SocketStatus;

  constructor(private readonly opts: {
    name: string;
    url: () => string;
    /** Sec-WebSocket-Protocol values; Mastodon reads its access token from here. */
    protocols?: () => Promise<string[]>;
    onMessage: (data: string) => void;
    onOpen?: (send: (data: string) => void) => void;
    /** Overridable so tests can drive the liveness cycle in milliseconds. */
    pingIntervalMs?: number;
    pongTimeoutMs?: number;
  }) {
    this.status = {
      name: opts.name, url: redact(opts.url()), state: "connecting",
      connectedAt: null, lastMessageAt: null, messages: 0, reconnects: 0, pongTimeouts: 0, lastError: null,
    };
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const url = this.opts.url();
    this.status.url = redact(url);
    this.status.state = "connecting";
    let socket: WebSocket;
    try {
      await assertPublicUrl(url.replace(/^ws(s?):/i, "http$1:"));
      const protocols = this.opts.protocols ? await this.opts.protocols() : undefined;
      if (this.closed) return;
      socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.backoff = MIN_BACKOFF_MS;
      this.status.state = "open";
      this.status.connectedAt = new Date().toISOString();
      this.status.lastError = null;
      this.startLiveness(socket);
      this.opts.onOpen?.((data) => socket.send(data));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data.length > MAX_FRAME_CHARS) return;
      this.status.messages++;
      this.status.lastMessageAt = new Date().toISOString();
      try {
        this.opts.onMessage(event.data);
      } catch (e) {
        this.status.lastError = `message handler: ${e instanceof Error ? e.message : String(e)}`;
      }
    };
    socket.onerror = (event) => { this.status.lastError = (event as { message?: string }).message ?? "socket error"; };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearLiveness();
      this.fail(this.status.lastError ?? `closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`);
    };
  }

  /**
   * Ping on a cadence; tear the connection down when one goes unanswered.
   * `terminate` rather than `close` because a peer that cannot answer a ping
   * will not answer a closing handshake either — that is the wait this exists
   * to end. The teardown lands in `onclose`, so the reconnect runs through the
   * same backoff path as every other disconnect.
   */
  private startLiveness(socket: WebSocket): void {
    const interval = this.opts.pingIntervalMs ?? PING_INTERVAL_MS;
    const timeout = this.opts.pongTimeoutMs ?? PONG_TIMEOUT_MS;
    this.clearLiveness();

    socket.on("pong", () => {
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    });

    this.heartbeat = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (this.pongTimer) return; // a ping is already outstanding
      try {
        socket.ping();
      } catch (e) {
        this.status.lastError = `ping: ${e instanceof Error ? e.message : String(e)}`;
        return;
      }
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        this.status.pongTimeouts++;
        this.status.lastError = `no pong within ${timeout}ms`;
        socket.terminate();
      }, timeout);
      this.pongTimer.unref();
    }, interval);
    this.heartbeat.unref();
  }

  private clearLiveness(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private fail(reason: string): void {
    this.status.lastError = reason;
    if (this.closed) return;
    this.status.state = "waiting";
    this.status.reconnects++;
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, this.backoff);
    this.timer.unref();
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
  }

  close(): void {
    this.closed = true;
    this.status.state = "closed";
    if (this.timer) clearTimeout(this.timer);
    this.clearLiveness();
    this.socket?.close();
    this.socket = null;
  }
}

/** Status output must not leak tokens some streams accept in the query string. */
function redact(url: string): string {
  return url.replace(/([?&](access_token|token)=)[^&]+/gi, "$1•••");
}
