import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/types.js";
import { listFeedXml } from "./rss.js";

interface CreateListBody { title?: string; visibility?: string }
interface AddItemBody { articleId?: string }

const MAX_LIST_TITLE = 200;
const PUBLIC_FEED_LIMIT = 100;

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
    const list = storage.createList(userId(), { title, visibility });
    return reply.code(201).send(list);
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
