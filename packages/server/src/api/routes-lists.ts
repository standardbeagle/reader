import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/types.js";
import { listFeedXml } from "./rss.js";
import { InvalidListRule, parseListRule } from "./list-rule.js";

interface CreateListBody { title?: string; visibility?: string; rule?: unknown }
interface AddItemBody { articleId?: string }

const MAX_LIST_TITLE = 200;
const MAX_LIST_ITEMS = 1000;
const PUBLIC_FEED_LIMIT = 100;

const DYNAMIC_LIST_ERROR = { error: { code: "list_dynamic", message: "this list is filled by its rule; change the rule instead" } };

export function registerListRoutes(app: FastifyInstance, storage: Storage): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  app.get("/api/v1/lists", async () => ({ lists: storage.listLists(userId()) }));

  app.post<{ Body: CreateListBody }>("/api/v1/lists", async (req, reply) => {
    const title = req.body?.title?.trim();
    if (!title || title.length > MAX_LIST_TITLE) {
      return reply.code(400).send({ error: { code: "invalid_title", message: "title is required (max 200 chars)" } });
    }
    const visibility = req.body?.visibility ?? "private";
    if (visibility !== "public" && visibility !== "private") {
      return reply.code(400).send({ error: { code: "invalid_visibility", message: "visibility must be public or private" } });
    }
    let rule = null;
    if (req.body?.rule !== undefined && req.body.rule !== null) {
      try {
        rule = parseListRule(req.body.rule, (id) => storage.getFeed(id) !== null);
      } catch (e) {
        if (!(e instanceof InvalidListRule)) throw e;
        return reply.code(400).send({ error: { code: "invalid_rule", message: e.message } });
      }
    }
    const list = storage.createList(userId(), { title, visibility, rule });
    return reply.code(201).send(list);
  });

  app.patch<{ Params: { id: string }; Body: CreateListBody }>("/api/v1/lists/:id", async (req, reply) => {
    const list = storage.getList(req.params.id);
    if (!list || list.userId !== userId()) {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    const title = req.body?.title?.trim();
    if (req.body?.title !== undefined && (!title || title.length > MAX_LIST_TITLE)) {
      return reply.code(400).send({ error: { code: "invalid_title", message: "title is required (max 200 chars)" } });
    }
    const visibility = req.body?.visibility;
    if (visibility !== undefined && visibility !== "public" && visibility !== "private") {
      return reply.code(400).send({ error: { code: "invalid_visibility", message: "visibility must be public or private" } });
    }
    let rule;
    if (req.body?.rule !== undefined) {
      // A manual list's members would be orphaned behind a rule, and a dynamic
      // list has no members to fall back on, so a list keeps the kind it was made as.
      if (!list.rule) {
        return reply.code(409).send({ error: { code: "list_manual", message: "this list holds saved articles; create a dynamic list instead" } });
      }
      try {
        rule = parseListRule(req.body.rule, (id) => storage.getFeed(id) !== null);
      } catch (e) {
        if (!(e instanceof InvalidListRule)) throw e;
        return reply.code(400).send({ error: { code: "invalid_rule", message: e.message } });
      }
    }
    return storage.updateList(list.id, { ...(title ? { title } : {}), ...(visibility ? { visibility } : {}), ...(rule ? { rule } : {}) });
  });

  // Replace a manual list's articles, in the order given: how a playlist is curated.
  app.put<{ Params: { id: string }; Body: { articleIds?: unknown } }>("/api/v1/lists/:id/items", async (req, reply) => {
    const uid = userId();
    const list = storage.getList(req.params.id);
    if (!list || list.userId !== uid) {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    if (list.rule) return reply.code(409).send(DYNAMIC_LIST_ERROR);
    const ids = req.body?.articleIds;
    if (!Array.isArray(ids) || ids.length > MAX_LIST_ITEMS || !ids.every((id): id is string => typeof id === "string")) {
      return reply.code(400).send({ error: { code: "invalid_items", message: `articleIds must be an array of at most ${MAX_LIST_ITEMS} article ids` } });
    }
    const missing = ids.filter((id) => !storage.getArticle(uid, id));
    if (missing.length > 0) {
      return reply.code(404).send({ error: { code: "not_found", message: `unknown articles: ${missing.join(", ")}` } });
    }
    storage.setListItems(list.id, ids);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/v1/lists/:id", async (req, reply) => {
    const list = storage.getList(req.params.id);
    if (!list || list.userId !== userId()) {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    storage.deleteList(list.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: AddItemBody }>("/api/v1/lists/:id/items", async (req, reply) => {
    const uid = userId();
    const list = storage.getList(req.params.id);
    if (!list || list.userId !== uid) {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    if (list.rule) return reply.code(409).send(DYNAMIC_LIST_ERROR);
    const articleId = req.body?.articleId;
    if (!articleId || !storage.getArticle(uid, articleId)) {
      return reply.code(404).send({ error: { code: "not_found", message: "article not found" } });
    }
    storage.addToList(list.id, articleId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string; articleId: string } }>("/api/v1/lists/:id/items/:articleId", async (req, reply) => {
    const list = storage.getList(req.params.id);
    if (!list || list.userId !== userId()) {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    storage.removeFromList(list.id, req.params.articleId);
    return reply.code(204).send();
  });

  // Public RSS output. The token is the capability: private lists answer 404
  // here so the route never confirms they exist. Not under /api/ so feed
  // readers get a stable, shareable URL.
  app.get<{ Params: { token: string } }>("/lists/:token.xml", async (req, reply) => {
    const list = storage.getListByToken(req.params.token);
    if (!list || list.visibility !== "public") {
      return reply.code(404).send({ error: { code: "not_found", message: "list not found" } });
    }
    const articles = storage.listListArticles(list.id, PUBLIC_FEED_LIMIT);
    const selfUrl = `${req.protocol}://${req.host}/lists/${list.token}.xml`;
    return reply
      .type("application/rss+xml; charset=utf-8")
      .send(listFeedXml(list, articles, selfUrl));
  });
}
