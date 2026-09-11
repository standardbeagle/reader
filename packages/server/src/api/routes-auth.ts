import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Storage } from "../storage/types.js";
import { CredentialError, describeCredential } from "../auth/credentials.js";
import { completeFlow, startGenericFlow, startMastodonFlow, startRedditFlow } from "../auth/oauth.js";

interface StartBody {
  provider?: string;
  instance?: string;
  clientId?: string;
  clientSecret?: string;
  feedUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scope?: string;
}

interface CreateCredentialBody {
  kind?: string;
  url?: string;
  username?: string;
  password?: string;
  token?: string;
}

const INSTANCE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function nonEmpty(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * The provider must redirect back to the address the browser is using, which
 * only the browser knows (loopback, the tunnel hostname, or the Vite proxy).
 * Browsers set Origin on every fetch POST and page script cannot forge it.
 */
function redirectUriFor(req: FastifyRequest): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !/^https?:\/\/[^/\s]+$/.test(origin)) return null;
  return `${origin}/api/v1/oauth/callback`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The popup the provider redirected to reports back to the opener and closes. */
function callbackPage(reply: FastifyReply, message: { ok: true; credential: ReturnType<typeof describeCredential> } | { ok: false; error: string }) {
  // JSON inside a script: escape "<" so a crafted error string cannot close the tag.
  const payload = JSON.stringify({ type: "reader-oauth", ...message }).replace(/</g, "\\u003c");
  const text = message.ok ? `Connected ${message.credential.label}. You can close this window.` : `Sign-in failed: ${message.error}`;
  return reply
    .code(message.ok ? 200 : 400)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .send(`<!doctype html><meta charset="utf-8"><title>Reader sign-in</title><p>${escapeHtml(text)}</p>
<script>if (window.opener) { window.opener.postMessage(${payload}, window.location.origin); window.close(); }</script>`);
}

export function registerAuthRoutes(app: FastifyInstance, storage: Storage): void {
  const userId = () => storage.getOrCreateLocalUser().id;
  const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
    reply.code(status).send({ error: { code, message } });

  const usage = (credentialId: string): number =>
    storage.listFeeds(userId()).filter((f) => f.credentialId === credentialId).length
    + storage.listIngestors(userId()).filter((i) => i.config.credentialId === credentialId).length;

  app.get("/api/v1/credentials", async () => ({
    credentials: storage.listCredentials(userId()).map((c) => ({ ...describeCredential(c), usedBy: usage(c.id) })),
  }));

  // Basic and bearer credentials for a feed; OAuth credentials come from the sign-in flow.
  app.post<{ Body: CreateCredentialBody }>("/api/v1/credentials", async (req, reply) => {
    const url = httpUrl(req.body?.url);
    if (!url) return fail(reply, 400, "invalid_credential", "url must be the http(s) feed address the credential is for");
    const kind = req.body?.kind;
    let secret;
    if (kind === "basic") {
      const username = nonEmpty(req.body?.username);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!username || !password) return fail(reply, 400, "invalid_credential", "basic credentials need a username and password");
      secret = { kind: "basic" as const, username, password };
    } else if (kind === "bearer") {
      const token = nonEmpty(req.body?.token);
      if (!token) return fail(reply, 400, "invalid_credential", "a bearer credential needs a token");
      secret = { kind: "bearer" as const, token };
    } else {
      return fail(reply, 400, "invalid_credential", "kind must be basic or bearer");
    }
    const credential = storage.createCredential(userId(), { provider: "generic", label: url.host, origin: url.origin, secret });
    return reply.code(201).send({ ...describeCredential(credential), usedBy: 0 });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/credentials/:id", async (req, reply) => {
    if (!storage.getCredential(req.params.id)) return fail(reply, 404, "not_found", "credential not found");
    const used = usage(req.params.id);
    if (used > 0) return fail(reply, 409, "credential_in_use", `${used} source(s) still sign in with this account; remove them first`);
    storage.deleteCredential(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Body: StartBody }>("/api/v1/oauth/start", async (req, reply) => {
    const redirectUri = redirectUriFor(req);
    if (!redirectUri) return fail(reply, 400, "oauth_origin_required", "start sign-in from the Reader web app (no Origin header)");
    const body = req.body ?? {};
    try {
      if (body.provider === "mastodon") {
        const instance = nonEmpty(body.instance)?.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
        if (!instance || !INSTANCE_HOST.test(instance)) return fail(reply, 400, "invalid_oauth", "instance must be a host name like mastodon.social");
        return { authorizeUrl: await startMastodonFlow(userId(), `https://${instance}`, redirectUri) };
      }
      if (body.provider === "reddit") {
        const clientId = nonEmpty(body.clientId);
        const clientSecret = nonEmpty(body.clientSecret);
        if (!clientId || !clientSecret) return fail(reply, 400, "invalid_oauth", "reddit sign-in needs the client id and secret of a web app");
        return { authorizeUrl: startRedditFlow(userId(), { clientId, clientSecret }, redirectUri) };
      }
      if (body.provider === "generic") {
        const feedUrl = httpUrl(body.feedUrl);
        const authorizeUrl = httpUrl(body.authorizeUrl);
        const tokenUrl = httpUrl(body.tokenUrl);
        const clientId = nonEmpty(body.clientId);
        if (!feedUrl || !authorizeUrl || !tokenUrl || !clientId) {
          return fail(reply, 400, "invalid_oauth", "feedUrl, authorizeUrl, tokenUrl and clientId are required");
        }
        return {
          authorizeUrl: startGenericFlow(userId(), {
            feedUrl: feedUrl.href, authorizeUrl: authorizeUrl.href, tokenUrl: tokenUrl.href,
            clientId, clientSecret: nonEmpty(body.clientSecret), scope: nonEmpty(body.scope),
          }, redirectUri),
        };
      }
      return fail(reply, 400, "invalid_oauth", "provider must be mastodon, reddit or generic");
    } catch (e) {
      return fail(reply, 422, "oauth_failed", e instanceof Error ? e.message : String(e));
    }
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string; error_description?: string } }>(
    "/api/v1/oauth/callback",
    async (req, reply) => {
      const { state, code, error } = req.query;
      if (error) return callbackPage(reply, { ok: false, error: req.query.error_description ?? error });
      if (!state || !code) return callbackPage(reply, { ok: false, error: "the provider sent no authorization code" });
      try {
        const credential = await completeFlow(storage, state, code);
        return callbackPage(reply, { ok: true, credential: describeCredential(credential) });
      } catch (e) {
        const message = e instanceof CredentialError ? e.message : "could not finish sign-in";
        req.log.warn({ err: e }, "oauth callback failed");
        return callbackPage(reply, { ok: false, error: message });
      }
    },
  );
}
