import type { FastifyInstance } from "fastify";
import { FEED_KINDS, MEDIA_FILTERS } from "../storage/types.js";

// Model Context Protocol over Streamable HTTP, stateless: every POST carries
// one JSON-RPC message and gets one JSON answer; there is no session and no
// server-initiated stream. Each tool is a thin mapping onto the REST API,
// called in-process, so a tool can never do anything the HTTP API would refuse
// and there is one copy of every validation rule.

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Version of the tool surface below, not of reader. */
const MCP_SERVER_VERSION = "1.0.0";
const MAX_TOOL_ARTICLES = 100;
const MAX_TOOL_ITEMS = 200;
const MAX_ARTICLE_TEXT = 8000;

type Args = Record<string, unknown>;
interface ApiCall { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; url: string; payload?: unknown }
interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** One REST call, or several run in order (the last answer is returned). */
  calls(args: Args): ApiCall[];
  /** Trim the REST answer down to what a model needs. */
  shape?(body: unknown): unknown;
}

/** Bad tool arguments: reported to the model as a tool error, not a protocol error. */
class ToolInputError extends Error {}

function text(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new ToolInputError(`${key} is required and must be a string`);
  return value;
}

function ids(args: Args, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length > MAX_TOOL_ITEMS || !value.every((v): v is string => typeof v === "string" && v !== "")) {
    throw new ToolInputError(`${key} must be an array of at most ${MAX_TOOL_ITEMS} ids`);
  }
  return value;
}

const seg = encodeURIComponent;
const YOUTUBE_ARTICLE = /^https:\/\/(www\.youtube\.com\/(watch|shorts\/)|youtu\.be\/)/i;

interface ApiArticle {
  id: string; feedId: string; title: string; author: string | null; url: string | null; publishedAt: string | null;
  categories: string[]; media: { url: string; type: string | null } | null; readAt: string | null;
  contentHtml: string | null; summary: string | null; listIds?: string[];
}

function compactArticle(a: ApiArticle) {
  const media = a.media ? (a.media.type?.startsWith("video/") ? "video" : "audio") : a.url && YOUTUBE_ARTICLE.test(a.url) ? "video" : null;
  return { id: a.id, feedId: a.feedId, title: a.title, author: a.author, url: a.url, publishedAt: a.publishedAt, categories: a.categories, media, read: a.readAt !== null };
}

function htmlToText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const RULE_SCHEMA = {
  type: "object",
  description: "Every set field must match. Omit a field to leave it unrestricted.",
  properties: {
    feedIds: { type: "array", items: { type: "string" }, description: "Only these feeds." },
    feedCategory: { type: "string", description: "Only feeds filed under this category." },
    feedKind: { type: "string", enum: FEED_KINDS },
    category: { type: "string", description: "Only articles carrying this subject tag." },
    media: { type: "string", enum: MEDIA_FILTERS, description: "Only playable articles: any media, audio, or video." },
    unreadOnly: { type: "boolean" },
    maxAgeDays: { type: "integer", minimum: 1, description: "Only articles published within this many days." },
    order: { type: "string", enum: ["newest", "oldest"] },
  },
  additionalProperties: false,
};

const TOOLS: Tool[] = [
  {
    name: "feeds_list",
    description: "List every subscribed feed with its id, title, kind (article, podcast, video, social), the user's category for it, and unread count.",
    inputSchema: { type: "object", properties: {} },
    calls: () => [{ method: "GET", url: "/api/v1/feeds" }],
    shape: (body) => ({
      feeds: (body as { feeds: { id: string; title: string; url: string; kind: string; category: string | null; unreadCount: number }[] }).feeds
        .map((f) => ({ id: f.id, title: f.title, url: f.url, kind: f.kind, category: f.category, unreadCount: f.unreadCount })),
    }),
  },
  {
    name: "feed_set_category",
    description: "File a feed under a category (the user's own grouping), or pass null to clear it.",
    inputSchema: { type: "object", properties: { feedId: { type: "string" }, category: { type: ["string", "null"] } }, required: ["feedId", "category"] },
    calls: (args) => {
      if (args.category !== null && typeof args.category !== "string") throw new ToolInputError("category must be a string or null");
      return [{ method: "PATCH", url: `/api/v1/feeds/${seg(text(args, "feedId"))}`, payload: { category: args.category } }];
    },
  },
  {
    name: "articles_list",
    description: "List articles from a stream, newest first unless ordered otherwise. Narrow the stream with any combination of filters; listId reads a list (a manual list in its own order, a dynamic list by its rule). Returns compact rows and nextCursor; pass nextCursor back as cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        feedId: { type: "string" },
        listId: { type: "string" },
        feedCategory: { type: "string" },
        feedKind: { type: "string", enum: FEED_KINDS },
        category: { type: "string", description: "Article subject tag." },
        media: { type: "string", enum: MEDIA_FILTERS },
        unreadOnly: { type: "boolean" },
        order: { type: "string", enum: ["newest", "oldest", "position"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_TOOL_ARTICLES, default: 25 },
        cursor: { type: "object", properties: { before: { type: "string" }, beforeId: { type: "string" } }, required: ["before", "beforeId"] },
      },
    },
    calls: (args) => {
      const q = new URLSearchParams();
      const params: [string, string][] = [["feedId", "feed_id"], ["listId", "list_id"], ["feedCategory", "feed_category"], ["feedKind", "feed_kind"], ["category", "category"], ["media", "media"], ["order", "order"]];
      for (const [key, param] of params) if (args[key] !== undefined) q.set(param, text(args, key));
      if (args.unreadOnly === true) q.set("unread", "1");
      const limit = args.limit ?? 25;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_TOOL_ARTICLES) {
        throw new ToolInputError(`limit must be a whole number from 1 to ${MAX_TOOL_ARTICLES}`);
      }
      q.set("limit", String(limit));
      if (args.cursor !== undefined) {
        const cursor = args.cursor as Args;
        if (!cursor || typeof cursor !== "object") throw new ToolInputError("cursor must be the nextCursor object from the previous page");
        q.set("before", text(cursor, "before"));
        q.set("before_id", text(cursor, "beforeId"));
      }
      return [{ method: "GET", url: `/api/v1/articles?${q}` }];
    },
    shape: (body) => {
      const page = body as { articles: ApiArticle[]; nextCursor: unknown };
      return { articles: page.articles.map(compactArticle), nextCursor: page.nextCursor };
    },
  },
  {
    name: "article_get",
    description: `Read one article: its metadata, the lists it is saved in, and its text (HTML removed, cut at ${MAX_ARTICLE_TEXT} characters).`,
    inputSchema: { type: "object", properties: { articleId: { type: "string" } }, required: ["articleId"] },
    calls: (args) => [{ method: "GET", url: `/api/v1/articles/${seg(text(args, "articleId"))}` }],
    shape: (body) => {
      const a = body as ApiArticle;
      const full = a.contentHtml ? htmlToText(a.contentHtml) : a.summary ?? "";
      return { ...compactArticle(a), listIds: a.listIds ?? [], text: full.slice(0, MAX_ARTICLE_TEXT), truncated: full.length > MAX_ARTICLE_TEXT };
    },
  },
  {
    name: "article_set_read",
    description: "Mark an article read or unread.",
    inputSchema: { type: "object", properties: { articleId: { type: "string" }, read: { type: "boolean" } }, required: ["articleId", "read"] },
    calls: (args) => {
      if (typeof args.read !== "boolean") throw new ToolInputError("read must be true or false");
      return [
        // The read route creates state for any id; look the article up first so a wrong id is an error.
        { method: "GET", url: `/api/v1/articles/${seg(text(args, "articleId"))}` },
        { method: "POST", url: `/api/v1/articles/${seg(text(args, "articleId"))}/read`, payload: { read: args.read } },
      ];
    },
  },
  {
    name: "lists_list",
    description: "List the user's lists (playlists). A list with rule=null is manual: it holds chosen articles in a set order. A list with a rule is dynamic: it contains whatever matches the rule right now.",
    inputSchema: { type: "object", properties: {} },
    calls: () => [{ method: "GET", url: "/api/v1/lists" }],
    shape: (body) => ({
      lists: (body as { lists: { id: string; title: string; visibility: string; rule: unknown; itemCount: number }[] }).lists
        .map((l) => ({ id: l.id, title: l.title, visibility: l.visibility, rule: l.rule, itemCount: l.itemCount })),
    }),
  },
  {
    name: "list_create",
    description: "Create a list (playlist). Omit rule for a manual list you fill with list_set_items or list_add_items; give a rule for a dynamic list that fills itself. A list keeps the kind it is created as.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, rule: RULE_SCHEMA }, required: ["title"] },
    calls: (args) => [{ method: "POST", url: "/api/v1/lists", payload: { title: text(args, "title"), ...(args.rule !== undefined ? { rule: args.rule } : {}) } }],
  },
  {
    name: "list_update",
    description: "Rename a list, or replace a dynamic list's rule.",
    inputSchema: { type: "object", properties: { listId: { type: "string" }, title: { type: "string" }, rule: RULE_SCHEMA }, required: ["listId"] },
    calls: (args) => [{
      method: "PATCH", url: `/api/v1/lists/${seg(text(args, "listId"))}`,
      payload: { ...(args.title !== undefined ? { title: text(args, "title") } : {}), ...(args.rule !== undefined ? { rule: args.rule } : {}) },
    }],
  },
  {
    name: "list_delete",
    description: "Delete a list. Its articles stay in their feeds.",
    inputSchema: { type: "object", properties: { listId: { type: "string" } }, required: ["listId"] },
    calls: (args) => [{ method: "DELETE", url: `/api/v1/lists/${seg(text(args, "listId"))}` }],
  },
  {
    name: "list_set_items",
    description: "Replace a manual list's articles with exactly these, in this order. This is how to curate or reorder a playlist in one step; articles left out are removed from the list.",
    inputSchema: { type: "object", properties: { listId: { type: "string" }, articleIds: { type: "array", items: { type: "string" }, maxItems: MAX_TOOL_ITEMS } }, required: ["listId", "articleIds"] },
    calls: (args) => [{ method: "PUT", url: `/api/v1/lists/${seg(text(args, "listId"))}/items`, payload: { articleIds: ids(args, "articleIds") } }],
  },
  {
    name: "list_add_items",
    description: "Append articles to the end of a manual list, in the order given. Articles already in the list keep their place.",
    inputSchema: { type: "object", properties: { listId: { type: "string" }, articleIds: { type: "array", items: { type: "string" }, maxItems: MAX_TOOL_ITEMS } }, required: ["listId", "articleIds"] },
    calls: (args) => ids(args, "articleIds").map((articleId) => ({ method: "POST" as const, url: `/api/v1/lists/${seg(text(args, "listId"))}/items`, payload: { articleId } })),
  },
  {
    name: "list_remove_items",
    description: "Remove articles from a manual list.",
    inputSchema: { type: "object", properties: { listId: { type: "string" }, articleIds: { type: "array", items: { type: "string" }, maxItems: MAX_TOOL_ITEMS } }, required: ["listId", "articleIds"] },
    calls: (args) => ids(args, "articleIds").map((articleId) => ({ method: "DELETE" as const, url: `/api/v1/lists/${seg(text(args, "listId"))}/items/${seg(articleId)}` })),
  },
];

interface RpcMessage { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

export function registerMcpRoutes(app: FastifyInstance): void {
  const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  const callTool = async (name: unknown, args: Args) => {
    const tool = typeof name === "string" ? toolsByName.get(name) : undefined;
    const failed = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });
    if (!tool) return failed(`unknown tool: ${String(name)}`);
    let calls: ApiCall[];
    try {
      calls = tool.calls(args);
    } catch (e) {
      if (!(e instanceof ToolInputError)) throw e;
      return failed(e.message);
    }
    let body: unknown = null;
    for (const call of calls) {
      const res = await app.inject({ method: call.method, url: call.url, ...(call.payload !== undefined ? { payload: call.payload as object } : {}) });
      body = res.body ? res.json() : null;
      if (res.statusCode >= 400) {
        const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
        return failed(`${error?.code ?? `http_${res.statusCode}`}: ${error?.message ?? "request failed"}`);
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(tool.shape ? tool.shape(body) : body ?? { ok: true }) }] };
  };

  app.post<{ Body: unknown }>("/mcp", async (req, reply) => {
    // A browser page on another origin must not drive this endpoint (DNS
    // rebinding); non-browser MCP clients send no Origin header at all.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost: string | null = null;
      try { originHost = new URL(origin).host; } catch { /* malformed Origin is refused below */ }
      if (originHost !== req.headers.host) {
        return reply.code(403).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "cross-origin request refused" } });
      }
    }
    const message = req.body as RpcMessage | null;
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "expected one JSON-RPC 2.0 message" } });
    }
    // Notifications (no id) are acknowledged and need no answer.
    if (message.id === undefined || message.id === null) return reply.code(202).send();
    const result = (value: unknown) => ({ jsonrpc: "2.0", id: message.id, result: value });
    const params = (message.params && typeof message.params === "object" ? message.params : {}) as Args;
    switch (message.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return result({
          protocolVersion: typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "reader", version: MCP_SERVER_VERSION },
          instructions: "Reader is a feed reader. Feeds have a kind and a user category; a stream is any filtered slice of articles; lists are playlists — manual (ordered, curated) or dynamic (a rule).",
        });
      }
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const args = params.arguments ?? {};
        if (typeof args !== "object" || Array.isArray(args)) {
          return { jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "arguments must be an object" } };
        }
        return result(await callTool(params.name, args as Args));
      }
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } };
    }
  });

  // No server-initiated stream is offered, which the transport spells as 405.
  app.get("/mcp", async (_req, reply) => reply.code(405).header("allow", "POST").send());
}
