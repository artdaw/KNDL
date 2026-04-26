// remote/sync.ts — pull driver for Anthropic Memory Store → local FactStore.
//
// Translation: each Memory Store item becomes one Fact.
// Idempotency:  same item id → same source URI → existing fact detected by
//               querying source field → no-op if content hash unchanged,
//               supersede if content changed.
// Conflict:     after each pull batch, run contradictions() to surface any
//               conflicts between pulled facts and local facts on the same
//               subject/predicate.
// Push:         explicitly OUT OF SCOPE for v2.0 (plan §12 Q8). The push()
//               function is a stub that throws; it will be filled in v2.1.

import { createHash } from "node:crypto";
import type { FactStore, Fact } from "../types.js";
import { nowIso } from "../core.js";
import type { MemoryStoreClient, RemoteConfig, SyncResult } from "./types.js";

// ── Translation ────────────────────────────────────────────────────────────────

function itemSourceUri(storeId: string, itemId: string): string {
  return `claude-memory://${storeId}/${itemId}`;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function itemToFactId(storeId: string, itemId: string): string {
  // Stable fact id tied to the Memory Store item id.
  const slug = `${storeId}-${itemId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  return `fact:claude-store-${slug}`;
}

// ── Existing-fact lookup ───────────────────────────────────────────────────────
// We find whether a Memory Store item has already been pulled by looking for
// a fact whose source == claude-memory://{storeId}/{itemId}.
// Because the FactStore interface has no index on source, we load all and filter.
// For large stores this is fine — remote pull is infrequent and bounded by API rate.

async function findBySource(store: FactStore, sourceUri: string): Promise<Fact | null> {
  const result = await store.query();
  return result.facts.find((f) => f.source === sourceUri) ?? null;
}

// ── Pull driver ────────────────────────────────────────────────────────────────

export async function pull(
  client: MemoryStoreClient,
  store: FactStore,
  config: RemoteConfig,
): Promise<SyncResult> {
  const syncedAt = nowIso();
  let pulled = 0, skipped = 0, superseded = 0;
  let cursor = config.last_cursor;

  // Paginate through all items (or all new items after the last cursor).
  // NOTE: If the API supports a true "since watermark" (not pagination cursor),
  // replace cursor logic with since=config.last_synced_at when that is verified.
  let hasMore = true;
  while (hasMore) {
    const page = await client.listItems(config.store_id, { after: cursor, limit: 100 });

    for (const item of page.items) {
      const sourceUri = itemSourceUri(config.store_id, item.id);
      const existing  = await findBySource(store, sourceUri);

      if (existing) {
        // Check if content changed (hash stored in tags or statement prefix).
        const existingHash = existing.tags?.find((t) => t.startsWith("content-hash:"))?.slice(13);
        const newHash = contentHash(item.content);
        if (existingHash === newHash) {
          skipped++;
          continue;
        }
        // Content changed — supersede the old fact.
        await store.supersedeFact(existing["@id"], {
          statement:  item.content,
          confidence: config.default_confidence,
          source:     sourceUri,
          validFrom:  item.updated_at ?? item.created_at,
          tenant:     config.label,
          tags:       ["from-anthropic-memory", config.store_id, `content-hash:${newHash}`],
        });
        superseded++;
      } else {
        // New item — assert as a fact.
        await store.assertFact({
          statement:  item.content,
          confidence: config.default_confidence,
          source:     sourceUri,
          validFrom:  item.created_at,
          observedAt: item.created_at,
          tenant:     config.label,
          tags:       ["from-anthropic-memory", config.store_id, `content-hash:${contentHash(item.content)}`],
        });
        pulled++;
      }
    }

    if (page.next_cursor) cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  // Update watermark on config (caller must persist this).
  config.last_synced_at = syncedAt;
  if (cursor) config.last_cursor = cursor;

  // Run contradictions to surface any conflicts that pulling introduced.
  const contradictResult = await store.contradictions({ tenant: config.label });
  const contradictions = contradictResult.count;

  return { store_id: config.store_id, label: config.label, pulled, skipped, superseded, contradictions, synced_at: syncedAt };
}

// ── Push stub (v2.1) ──────────────────────────────────────────────────────────

export async function push(
  _client: MemoryStoreClient,
  _store: FactStore,
  _config: RemoteConfig,
): Promise<never> {
  throw new Error(
    "push() is not implemented in v2.0. " +
    "Push (local → Anthropic Memory Store) will ship in v2.1. " +
    "To share local facts, export with `kndl export` and paste into the Memory Store manually.",
  );
}
