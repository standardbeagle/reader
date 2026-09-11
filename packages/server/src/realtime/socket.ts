import { assertPublicUrl } from "../net-guard.js";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Frames above this are dropped unparsed; every stream we read sends small JSON. */
export const MAX_FRAME_CHARS = 256 * 1024;

export interface SocketStatus {
  name: string;
  url: string;
  state: "connecting" | "open" | "waiting" | "closed";
  connectedAt: string | null;
  lastMessageAt: string | null;
  messages: number;
  reconnects: number;
  lastError: string | null;
}

/**
 * An outbound WebSocket that reconnects with exponential backoff until
 * closed. The URL goes through the SSRF guard on every connect, like HTTP
 * fetches do, and oversized frames are dropped before parsing. `url` is a
 * function so a reconnect can resume from a cursor.
 */
export class ReconnectingSocket {
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
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
  }) {
    this.status = {
      name: opts.name, url: redact(opts.url()), state: "connecting",
      connectedAt: null, lastMessageAt: null, messages: 0, reconnects: 0, lastError: null,
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
      this.fail(this.status.lastError ?? `closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`);
    };
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
    this.socket?.close();
    this.socket = null;
  }
}

/** Status output must not leak tokens some streams accept in the query string. */
function redact(url: string): string {
  return url.replace(/([?&](access_token|token)=)[^&]+/gi, "$1•••");
}
