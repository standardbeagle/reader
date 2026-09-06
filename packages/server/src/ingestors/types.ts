import type { NormalizedItem, Storage } from "../storage/types.js";

export interface AdapterResult {
  items: NormalizedItem[];
  cursor: Record<string, unknown>;
}

/** Storage-backed context handed to adapters; only storage-reading adapters use it. */
export interface AdapterContext {
  storage: Storage;
  userId: string;
}

export interface IngestorAdapter {
  validate(config: Record<string, unknown>): Promise<string>;
  fetch(config: Record<string, unknown>, cursor: Record<string, unknown> | null, ctx: AdapterContext): Promise<AdapterResult>;
}
