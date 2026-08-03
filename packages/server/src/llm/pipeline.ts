import type { LlmClient } from "./client.js";
import type { NormalizedItem } from "../storage/types.js";

export interface KeptItem { item: NormalizedItem; title: string; summary: string; score: number | null }
export interface DroppedItem { item: NormalizedItem; score: number; reason: string }
export interface PipelineResult { kept: KeptItem[]; dropped: DroppedItem[] }

const BATCH = 20;

export async function processItems(
  items: NormalizedItem[],
  opts: { llm: LlmClient | null; threshold: number },
): Promise<PipelineResult> {
  if (!opts.llm) {
    return {
      kept: items.map((item) => ({
        item,
        title: item.title ?? item.text.slice(0, 80),
        summary: item.text,
        score: null,
      })),
      dropped: [],
    };
  }

  const kept: KeptItem[] = [];
  const dropped: DroppedItem[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const scores = await opts.llm.filterBatch(
      chunk.map((item) => ({ id: item.externalId, author: item.author, text: item.text })),
    );
    const scoreBy = new Map(scores.map((s) => [s.id, s]));
    const passing: { item: NormalizedItem; score: number }[] = [];
    for (const item of chunk) {
      const s = scoreBy.get(item.externalId);
      if (s === undefined) throw new Error(`llm filter missing score for item ${item.externalId}`);
      if (s.score >= opts.threshold) passing.push({ item, score: s.score });
      else dropped.push({ item, score: s.score, reason: s.reason });
    }
    if (passing.length > 0) {
      const summaries = await opts.llm.summarizeBatch(
        passing.map((p) => ({ id: p.item.externalId, title: p.item.title, text: p.item.text })),
      );
      const summaryBy = new Map(summaries.map((s) => [s.id, s]));
      for (const p of passing) {
        const s = summaryBy.get(p.item.externalId);
        if (s === undefined) throw new Error(`llm summary missing for item ${p.item.externalId}`);
        kept.push({
          item: p.item,
          title: s.title || p.item.title || p.item.text.slice(0, 80),
          summary: s.summary || p.item.text,
          score: p.score,
        });
      }
    }
  }
  return { kept, dropped };
}
