// remote/sync.ts — pull and push drivers for Anthropic Memory Store ↔ local FactStore.
//
// Pull (Anthropic → local):
//   Each Memory Store item becomes one Fact. Idempotent on item id; supersedes
//   if content changes. Runs contradictions() after each batch.
//
// Push (local → Anthropic):
//   Facts tagged with push_tag (default "push-to-anthropic") are serialized
//   to human-readable content and POSTed to the Memory Store. Idempotent:
//   existing items are detected via metadata.kndl_id. Classified facts
//   (PHI/PII/etc.) are skipped unless config explicitly sets allow_push_classified.

import { createHash } from "node:crypto";
import type { FactStore, Fact } from "../types.js";
import { nowIso } from "../core.js";
import type { MemoryStoreClient, RemoteConfig, SyncResult, PushResult, BothResult } from "./types.js";

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
  const contradictResult = await store.contradictions({ subject: config.label });
  const contradictions = contradictResult.count;

  return { store_id: config.store_id, label: config.label, pulled, skipped, superseded, contradictions, synced_at: syncedAt };
}

// ── Push driver (local → Anthropic) ──────────────────────────────────────────

/**
 * Serialize a Fact to human-readable Memory Store content.
 * The statement leads; structured fields follow; KNDL-ID anchors idempotency.
 */
function factToContent(fact: Fact): string {
  const lines: string[] = [fact.statement, ""];
  if (fact.subject)            lines.push(`subject: ${fact.subject}`);
  if (fact.predicate)          lines.push(`predicate: ${fact.predicate}`);
  if (fact.object !== undefined) lines.push(`object: ${JSON.stringify(fact.object)}`);
  lines.push(`confidence: ${fact.confidence}`);
  if (fact.decay)              lines.push(`decay: ${fact.decay}`);
  lines.push(`source: ${fact.source}`);
  lines.push(`validFrom: ${fact.validFrom}`);
  if (fact.recordedAt)         lines.push(`recordedAt: ${fact.recordedAt}`);
  if (fact.supersedes)         lines.push(`supersedes: ${fact.supersedes}`);
  lines.push(`KNDL-ID: ${fact["@id"]}`);
  return lines.join("\n");
}

export async function push(
  client: MemoryStoreClient,
  store: FactStore,
  config: RemoteConfig,
): Promise<PushResult> {
  if (!config.push) {
    throw new Error(
      `Push is disabled for remote '${config.label}'. ` +
      "Enable it with: kndl remote add --provider anthropic --store-id <id> --label <label> --push",
    );
  }

  const syncedAt = nowIso();
  const pushTag  = config.push_tag ?? "push-to-anthropic";

  // ── Select facts that qualify for push ───────────────────────────────────
  const { facts: allFacts } = await store.query();
  const candidates = allFacts.filter((f) => {
    // Must carry the push tag
    if (!f.tags?.includes(pushTag)) return false;
    // Skip classified data by default (PHI, PII, PCI, CONFIDENTIAL, INTERNAL)
    if (f.classification) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { store_id: config.store_id, label: config.label, pushed: 0, skipped: 0, errors: 0, synced_at: syncedAt };
  }

  // ── Find facts already in the Memory Store (via metadata.kndl_id) ────────
  const alreadyPushed = new Set<string>();
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const page = await client.listItems(config.store_id, { after: cursor, limit: 100 });
    for (const item of page.items) {
      const kndlId = item.metadata?.kndl_id as string | undefined;
      if (kndlId) alreadyPushed.add(kndlId);
    }
    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  // ── Push unpushed candidates ──────────────────────────────────────────────
  let pushed = 0, skipped = 0, errors = 0;
  for (const fact of candidates) {
    if (alreadyPushed.has(fact["@id"])) {
      skipped++;
      continue;
    }
    try {
      const content = factToContent(fact);
      await client.createItem(config.store_id, content, { kndl_id: fact["@id"] });
      pushed++;
    } catch (e) {
      process.stderr.write(
        `[kndl] push error for ${fact["@id"]}: ${(e as Error).message}\n`,
      );
      errors++;
    }
  }

  config.last_synced_at = syncedAt;
  return { store_id: config.store_id, label: config.label, pushed, skipped, errors, synced_at: syncedAt };
}

// ── Both directions ───────────────────────────────────────────────────────────

export async function syncBoth(
  client: MemoryStoreClient,
  store: FactStore,
  config: RemoteConfig,
): Promise<BothResult> {
  const pullResult = await pull(client, store, config);
  const pushResult = await push(client, store, config);
  return { pull: pullResult, push: pushResult };
}
