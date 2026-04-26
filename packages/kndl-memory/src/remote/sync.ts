// remote/sync.ts — bidirectional sync between local FactStore and Anthropic Memory Store.
//
// Pull (Anthropic → local):
//   Each Memory (path + content) becomes one Fact. Idempotent on path:
//   facts are tracked via source URI = anthropic-memory://{storeId}/{path}.
//   Content changes trigger supersession. Runs contradictions() after each batch.
//
// Push (local → Anthropic):
//   Facts tagged with push_tag (default "push-to-anthropic") are serialized to
//   human-readable content and stored at path /kndl-facts/{slugified-id}.
//   Idempotent: existing memory at that path is detected and skipped/updated.
//   Classified facts (PHI/PII/etc.) skipped unless config allows.

import { createHash } from "node:crypto";
import type { FactStore, Fact } from "../types.js";
import { nowIso } from "../core.js";
import type {
  MemoryStoreClient, Memory,
  RemoteConfig, SyncResult, PushResult, BothResult,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Source URI embedded in pulled facts — stable per store + memory path. */
function memorySourceUri(storeId: string, path: string): string {
  return `anthropic-memory://${storeId}${path}`;
}

/** Path in the Memory Store for a pushed KNDL fact. */
function factPath(factId: string): string {
  const slug = factId.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 120);
  return `/kndl-facts/${slug}`;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function findBySource(store: FactStore, sourceUri: string): Promise<Fact | null> {
  const { facts } = await store.query();
  return facts.find(f => f.source === sourceUri) ?? null;
}

// ── Pull driver ────────────────────────────────────────────────────────────────

export async function pull(
  client: MemoryStoreClient,
  store: FactStore,
  config: RemoteConfig,
): Promise<SyncResult> {
  const syncedAt = nowIso();
  let pulled = 0, skipped = 0, superseded = 0;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await client.listMemories(config.store_id, {
      view:   "full",
      limit:  100,
      page:   cursor,
    });

    for (const item of page.data) {
      if (item.type !== "memory") continue;      // skip prefix entries
      const memory = item as Memory;
      if (!memory.content) continue;             // skip basic-view entries

      const sourceUri = memorySourceUri(config.store_id, memory.path);
      const existing  = await findBySource(store, sourceUri);

      if (existing) {
        const existingHash = existing.tags?.find(t => t.startsWith("content-hash:"))?.slice(13);
        const newHash = contentHash(memory.content);
        if (existingHash === newHash) { skipped++; continue; }
        await store.supersedeFact(existing["@id"], {
          statement:  memory.content.split("\n")[0],  // first line as statement
          confidence: config.default_confidence,
          source:     sourceUri,
          validFrom:  memory.updated_at ?? memory.created_at,
          tenant:     config.label,
          tags:       ["from-anthropic-memory", config.store_id, `content-hash:${newHash}`, `path:${memory.path}`],
        });
        superseded++;
      } else {
        await store.assertFact({
          statement:  memory.content.split("\n")[0],
          confidence: config.default_confidence,
          source:     sourceUri,
          validFrom:  memory.created_at,
          observedAt: memory.created_at,
          tenant:     config.label,
          tags:       ["from-anthropic-memory", config.store_id, `content-hash:${contentHash(memory.content)}`, `path:${memory.path}`],
        });
        pulled++;
      }
    }

    cursor  = page.next_page;
    hasMore = page.has_more;
  }

  config.last_synced_at = syncedAt;

  const { count: contradictions } = await store.contradictions({ tenant: config.label });
  return { store_id: config.store_id, label: config.label, pulled, skipped, superseded, contradictions, synced_at: syncedAt };
}

// ── Push driver ────────────────────────────────────────────────────────────────

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

  // Select facts to push
  const { facts: allFacts } = await store.query();
  const candidates = allFacts.filter(f => {
    if (!f.tags?.includes(pushTag)) return false;
    if (f.classification)           return false; // skip PHI/PII by default
    return true;
  });

  if (candidates.length === 0) {
    return { store_id: config.store_id, label: config.label, pushed: 0, skipped: 0, errors: 0, synced_at: syncedAt };
  }

  // Find existing KNDL memories in the store (by path prefix)
  const existingPaths = new Set<string>();
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const page = await client.listMemories(config.store_id, {
      path_prefix: "/kndl-facts/",
      limit:       100,
      page:        cursor,
    });
    for (const item of page.data) {
      if (item.type === "memory") existingPaths.add((item as Memory).path);
    }
    cursor  = page.next_page;
    hasMore = page.has_more;
  }

  let pushed = 0, skipped = 0, errors = 0;
  for (const fact of candidates) {
    const path = factPath(fact["@id"]);
    if (existingPaths.has(path)) { skipped++; continue; }
    try {
      const content = factToContent(fact);
      await client.createMemory(config.store_id, path, content);
      pushed++;
    } catch (e) {
      process.stderr.write(`[kndl] push error for ${fact["@id"]}: ${(e as Error).message}\n`);
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
