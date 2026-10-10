import type { FastifyInstance, FastifyReply } from "fastify";
import type { Ingestor, Storage } from "../storage/types.js";
import type { IngestorEngine } from "../ingestors/engine.js";
import { CredentialError } from "../auth/credentials.js";
import { holdKey, libbySnapshot, type LibbySnapshot } from "../ingestors/libby.js";
import { libbyCredential, libbyExpiresAt, libbyIngestor, libbyToken, linkLibby, unlinkLibby } from "../libby/account.js";
import { LibbyError, borrowHold, cancelHold, placeHold, searchCatalog, suspendHold } from "../libby/client.js";

const SETUP_CODE = /^\d{8}$/;
const MAX_SUSPEND_DAYS = 365;
const MAX_SEARCH_QUERY = 100;

/** A hold change reader refuses before asking Libby, with the HTTP answer to give. */
class HoldRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const holdNotFound = () => new HoldRefused(404, "not_found", "that hold is not in your queue");

const NOT_LINKED = { error: { code: "libby_not_linked", message: "no Libby account is linked" } };

interface HoldParams { cardId: string; titleId: string }

export function registerLibbyRoutes(app: FastifyInstance, storage: Storage, engine: IngestorEngine): void {
  const userId = () => storage.getOrCreateLocalUser().id;

  // The account as of the last sync. The sign-in token is never part of it.
  const libbyState = () => {
    const ingestor = libbyIngestor(storage, userId());
    if (!ingestor) return { linked: false as const };
    const credential = libbyCredential(storage, ingestor);
    const expiresAt = credential ? libbyExpiresAt(credential) : null;
    const snapshot = libbySnapshot(ingestor.cursor);
    const holds = Object.values(snapshot?.holds ?? {})
      .map(({ seq: _seq, announcedPosition: _announced, ...hold }) => hold)
      .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.position ?? Infinity) - (b.position ?? Infinity) || a.title.localeCompare(b.title));
    return {
      linked: true as const,
      feedId: ingestor.feedId,
      cards: (snapshot?.cards ?? []).map(({ cardId, library, libraryKey }) => ({ cardId, library, libraryKey })),
      holds,
      lastSyncedAt: ingestor.lastFetchedAt,
      lastError: ingestor.lastError,
      signInExpiresAt: expiresAt,
      // The sign-in cannot be renewed once it has lapsed or been deleted; only a new setup code helps.
      needsRelink: !credential || (expiresAt !== null && Date.parse(expiresAt) <= Date.now()),
    };
  };

  const libbyFailure = (reply: FastifyReply, e: unknown) => {
    if (e instanceof HoldRefused) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
    if (e instanceof CredentialError) return reply.code(409).send({ error: { code: "libby_relink", message: e.message } });
    if (e instanceof LibbyError) return reply.code(502).send({ error: { code: "libby_failed", message: e.message } });
    throw e;
  };

  // Sync now and answer with the fresh account. A failed sync is an error, not a stale success.
  const syncAndReport = async (ingestor: Ingestor, reply: FastifyReply) => {
    // Ten failures park an ingestor; a person asking again is reason to try again.
    if (ingestor.status === "broken") storage.updateIngestorState(ingestor.id, { errorCount: 0, status: "ok" });
    const synced = await engine.processIngestor(ingestor.id);
    if ("error" in synced) {
      return reply.code(502).send({ error: { code: "libby_failed", message: synced.error }, libby: libbyState() });
    }
    return libbyState();
  };

  // Run one change against Libby, then re-sync so the holds view and the feed reflect it.
  const changeHolds = async (reply: FastifyReply, change: (token: string, snapshot: LibbySnapshot) => Promise<void>) => {
    const ingestor = libbyIngestor(storage, userId());
    if (!ingestor) return reply.code(404).send(NOT_LINKED);
    const snapshot = libbySnapshot(ingestor.cursor);
    if (!snapshot) return reply.code(409).send({ error: { code: "libby_not_synced", message: "the Libby account has not synced yet" } });
    try {
      await change(await libbyToken(storage, String(ingestor.config.credentialId)), snapshot);
    } catch (e) {
      return libbyFailure(reply, e);
    }
    return syncAndReport(ingestor, reply);
  };

  app.get("/api/v1/libby", async () => libbyState());

  app.post<{ Body: { code?: unknown } }>("/api/v1/libby/link", async (req, reply) => {
    const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s/g, "") : "";
    if (!SETUP_CODE.test(code)) {
      return reply.code(400).send({ error: { code: "invalid_code", message: "the setup code is 8 digits" } });
    }
    let ingestor;
    try {
      ingestor = await linkLibby(storage, userId(), code);
    } catch (e) {
      if (e instanceof LibbyError && e.status === 404) return reply.code(422).send({ error: { code: "libby_code_rejected", message: e.message } });
      return libbyFailure(reply, e);
    }
    return syncAndReport(ingestor, reply);
  });

  app.delete("/api/v1/libby", async (_req, reply) => {
    const ingestor = libbyIngestor(storage, userId());
    if (!ingestor) return reply.code(404).send(NOT_LINKED);
    unlinkLibby(storage, ingestor);
    return reply.code(204).send();
  });

  app.post("/api/v1/libby/sync", async (_req, reply) => {
    const ingestor = libbyIngestor(storage, userId());
    if (!ingestor) return reply.code(404).send(NOT_LINKED);
    return syncAndReport(ingestor, reply);
  });

  app.get<{ Querystring: { q?: string; card_id?: string } }>("/api/v1/libby/search", async (req, reply) => {
    const ingestor = libbyIngestor(storage, userId());
    if (!ingestor) return reply.code(404).send(NOT_LINKED);
    const query = req.query.q?.trim() ?? "";
    if (query.length < 2 || query.length > MAX_SEARCH_QUERY) {
      return reply.code(400).send({ error: { code: "invalid_query", message: `q must be 2 to ${MAX_SEARCH_QUERY} characters` } });
    }
    const cards = libbySnapshot(ingestor.cursor)?.cards ?? [];
    const card = req.query.card_id ? cards.find((c) => c.cardId === req.query.card_id) : cards.find((c) => c.libraryKey);
    if (!card?.libraryKey) return reply.code(404).send({ error: { code: "not_found", message: "no library card to search with" } });
    try {
      return { cardId: card.cardId, library: card.library, titles: await searchCatalog(card.libraryKey, query) };
    } catch (e) {
      return libbyFailure(reply, e);
    }
  });

  app.post<{ Body: { cardId?: unknown; titleId?: unknown } }>("/api/v1/libby/holds", async (req, reply) => {
    const { cardId, titleId } = req.body ?? {};
    if (typeof cardId !== "string" || typeof titleId !== "string" || !cardId || !titleId) {
      return reply.code(400).send({ error: { code: "invalid_hold", message: "cardId and titleId are required" } });
    }
    return changeHolds(reply, async (token, snapshot) => {
      if (!snapshot.cards.some((c) => c.cardId === cardId)) throw new HoldRefused(404, "not_found", "that library card is not on this account");
      if (snapshot.holds[holdKey({ cardId, titleId })]) throw new HoldRefused(409, "duplicate", "that title is already on hold");
      await placeHold(token, cardId, titleId);
    });
  });

  app.delete<{ Params: HoldParams }>("/api/v1/libby/holds/:cardId/:titleId", async (req, reply) =>
    changeHolds(reply, async (token, snapshot) => {
      const hold = snapshot.holds[holdKey(req.params)];
      if (!hold) throw holdNotFound();
      await cancelHold(token, hold.cardId, hold.titleId);
    }));

  // days = 0 lifts a suspension.
  app.post<{ Params: HoldParams; Body: { days?: unknown } }>("/api/v1/libby/holds/:cardId/:titleId/suspend", async (req, reply) => {
    const days = req.body?.days;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > MAX_SUSPEND_DAYS) {
      return reply.code(400).send({ error: { code: "invalid_days", message: `days must be a whole number from 0 to ${MAX_SUSPEND_DAYS}` } });
    }
    return changeHolds(reply, async (token, snapshot) => {
      const hold = snapshot.holds[holdKey(req.params)];
      if (!hold) throw holdNotFound();
      await suspendHold(token, hold.cardId, hold.titleId, days);
    });
  });

  app.post<{ Params: HoldParams }>("/api/v1/libby/holds/:cardId/:titleId/borrow", async (req, reply) =>
    changeHolds(reply, async (token, snapshot) => {
      const hold = snapshot.holds[holdKey(req.params)];
      const card = snapshot.cards.find((c) => c.cardId === req.params.cardId);
      if (!hold || !card) throw holdNotFound();
      if (!hold.ready) throw new HoldRefused(409, "hold_not_ready", "that hold is not ready to borrow yet");
      await borrowHold(token, card, hold);
    }));
}
