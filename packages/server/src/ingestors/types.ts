import type { NormalizedItem } from "../storage/types.js";

export interface AdapterResult {
  items: NormalizedItem[];
  cursor: Record<string, unknown>;
}

export interface IngestorAdapter {
  validate(config: Record<string, unknown>): Promise<string>;
  fetch(config: Record<string, unknown>, cursor: Record<string, unknown> | null): Promise<AdapterResult>;
}
