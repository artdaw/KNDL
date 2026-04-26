// remote/anthropic.ts — thin REST wrapper around the Anthropic Memory Stores beta API.
//
// Uses fetch() directly rather than the @anthropic-ai/sdk so that API surface
// changes don't require a hard dependency bump. Gate all calls on ANTHROPIC_API_KEY.
//
// NOTE (Phase 5 — open question Q7):
//   The Memory Stores API is in beta. We have NOT yet verified whether
//   it supports a watermark / "since" cursor for incremental pulls.
//   Until verified:
//     - We always paginate through the full list and detect new items by
//       comparing to the last_cursor stored in remotes.json.
//     - watch_memory_store is NOT shipped in v2.0 (would require the watcher
//       loop to poll efficiently; polling the full list every N seconds is
//       too expensive at reasonable intervals).
//   Once the watermark call is confirmed, upgrade listItems to use it and
//   re-enable watch_memory_store.
//
// Endpoints assumed (adjust if the beta API differs):
//   GET  /v1/memory-stores/{store_id}/items[?after=<cursor>&limit=<n>]
//   GET  /v1/memory-stores/{store_id}/items/{item_id}
//   POST /v1/memory-stores/{store_id}/items   (used by push, v2.1)
//
// Beta header: anthropic-beta: memory-stores-2025-08-01
// (Pin this to a date you've tested against; update when the API stabilises.)

import type { MemoryStoreClient, MemoryStoreItem, MemoryStoreListResult, ListItemsOptions } from "./types.js";

const BASE_URL = "https://api.anthropic.com";
const BETA_HEADER = "memory-stores-2025-08-01";
const API_VERSION = "2023-06-01";

/** Exponential backoff on 429 / 529 responses. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status !== 429 && status !== 529) throw e;
      if (attempt === maxRetries) break;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export class AnthropicMemoryClient implements MemoryStoreClient {
  constructor(private readonly apiKey: string) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const resp = await withRetry(async () => {
      const r = await fetch(url, {
        ...init,
        headers: {
          "x-api-key":        this.apiKey,
          "anthropic-version": API_VERSION,
          "anthropic-beta":    BETA_HEADER,
          "content-type":      "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        const err: { status: number; message: string } = {
          status: r.status,
          message: `Anthropic API ${r.status}: ${body.slice(0, 200)}`,
        };
        throw Object.assign(new Error(err.message), { status: r.status });
      }
      return r;
    });
    return resp.json() as Promise<T>;
  }

  async listItems(storeId: string, opts: ListItemsOptions = {}): Promise<MemoryStoreListResult> {
    const params = new URLSearchParams();
    if (opts.after) params.set("after", opts.after);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params}` : "";

    // Expected response shape — adjust to actual API response envelope.
    const raw = await this.fetch<{
      data?: MemoryStoreItem[];
      items?: MemoryStoreItem[];
      next_cursor?: string;
      has_more?: boolean;
    }>(`/v1/memory-stores/${storeId}/items${qs}`);

    const items = raw.data ?? raw.items ?? [];
    return {
      items,
      next_cursor: raw.next_cursor,
      has_more: raw.has_more ?? !!raw.next_cursor,
    };
  }

  async getItem(storeId: string, itemId: string): Promise<MemoryStoreItem | null> {
    try {
      return await this.fetch<MemoryStoreItem>(
        `/v1/memory-stores/${storeId}/items/${itemId}`,
      );
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async createItem(
    storeId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryStoreItem> {
    return this.fetch<MemoryStoreItem>(`/v1/memory-stores/${storeId}/items`, {
      method: "POST",
      body: JSON.stringify({ content, metadata }),
    });
  }
}

// ── Fake client for tests / CI ────────────────────────────────────────────────

export class FakeMemoryStoreClient implements MemoryStoreClient {
  private stores = new Map<string, Map<string, MemoryStoreItem>>();
  private seq = 0;

  seed(storeId: string, items: Array<{ content: string; metadata?: Record<string, unknown> }>): void {
    if (!this.stores.has(storeId)) this.stores.set(storeId, new Map());
    const store = this.stores.get(storeId)!;
    for (const item of items) {
      const id = `fake_item_${++this.seq}`;
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      store.set(id, { id, store_id: storeId, content: item.content, created_at: now, metadata: item.metadata });
    }
  }

  async listItems(storeId: string, opts: ListItemsOptions = {}): Promise<MemoryStoreListResult> {
    const store = this.stores.get(storeId);
    const all = store ? [...store.values()] : [];
    const startIdx = opts.after
      ? all.findIndex((i) => i.id === opts.after) + 1
      : 0;
    const limit = opts.limit ?? 100;
    const page = all.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + limit < all.length;
    return {
      items: page,
      next_cursor: hasMore ? page[page.length - 1]?.id : undefined,
      has_more: hasMore,
    };
  }

  async getItem(storeId: string, itemId: string): Promise<MemoryStoreItem | null> {
    return this.stores.get(storeId)?.get(itemId) ?? null;
  }

  async createItem(storeId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryStoreItem> {
    if (!this.stores.has(storeId)) this.stores.set(storeId, new Map());
    const id = `fake_item_${++this.seq}`;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const item: MemoryStoreItem = { id, store_id: storeId, content, created_at: now, metadata };
    this.stores.get(storeId)!.set(id, item);
    return item;
  }
}
