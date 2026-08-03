export interface FilterScore { id: string; score: number; reason: string }
export interface Summary { id: string; title: string; summary: string }

export interface LlmClient {
  filterBatch(items: { id: string; author: string | null; text: string }[]): Promise<FilterScore[]>;
  summarizeBatch(items: { id: string; title: string | null; text: string }[]): Promise<Summary[]>;
}

const FILTER_SYSTEM = `You are a content filter for a power user's feed reader. Score each item 0-10 for signal. Clickbait, ragebait, engagement bait, memes, low-effort jokes, and promotional spam score 0-3. Substantive technical content, informative news, and thoughtful analysis score 7-10. Return ONLY a JSON array of {"id": string, "score": number, "reason": string (max 8 words)}.`;
const SUMMARY_SYSTEM = `Rewrite each item for a feed reader. Return ONLY a JSON array of {"id": string, "title": string (factual, no clickbait, max 10 words), "summary": string (1-2 factual sentences)}. Preserve meaning; no commentary.`;

export function createOpenRouterClient(opts: { apiKey: string; model: string; baseUrl?: string }): LlmClient {
  const base = opts.baseUrl ?? "https://openrouter.ai/api/v1";

  async function chat(system: string, user: string): Promise<unknown[]> {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`llm request failed: HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) throw new Error("llm returned no json array");
    try {
      return JSON.parse(content.slice(start, end + 1)) as unknown[];
    } catch {
      throw new Error("llm returned malformed json");
    }
  }

  return {
    async filterBatch(items) {
      const user = JSON.stringify(items.map((i) => ({ id: i.id, author: i.author, text: i.text.slice(0, 500) })));
      const out = await chat(FILTER_SYSTEM, user);
      return out.map((r) => {
        const o = r as Record<string, unknown>;
        return { id: String(o.id), score: Number(o.score), reason: String(o.reason ?? "") };
      });
    },
    async summarizeBatch(items) {
      const user = JSON.stringify(items.map((i) => ({ id: i.id, title: i.title, text: i.text.slice(0, 800) })));
      const out = await chat(SUMMARY_SYSTEM, user);
      return out.map((r) => {
        const o = r as Record<string, unknown>;
        return { id: String(o.id), title: String(o.title ?? ""), summary: String(o.summary ?? "") };
      });
    },
  };
}
