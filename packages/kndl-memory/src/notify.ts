// notify.ts — change detection and broadcast layer.
//
// Adapts each backend's native change feed into a shared EventEmitter so the
// MCP server's broadcast loop is store-agnostic.
//
// In-process writes: NotifyingStore wraps any FactStore and fires "change" on
// every assertFact / supersedeFact call. This covers:
//   - all writes from the same MCP process (the common case)
//
// Cross-process writes (a second process writing to the same store):
//   - FsFactStore:    chokidar watches the facts/ directory for new .fact.json files
//   - SqliteFactStore: SQLite update_hook fires for any INSERT in the same connection;
//                     for cross-process we attach a polling loop on kndl_changes table
//
// DuckDB and Supabase cross-process detection is not implemented in v2.0 —
// for those backends, use the HTTP transport (single process, all writes through it).

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { FactStore, FactInput, QueryOptions, QueryResult,
  ContradictionsResult, ProvenanceResult, AssertResult, SupersedeResult, Fact } from "./types";

// ── Change event ──────────────────────────────────────────────────────────────

export interface ChangeEvent {
  factId: string;
  type: "created" | "superseded";
}

// ── NotifyingStore — wraps any FactStore, emits "change" on every write ───────

export class NotifyingStore implements FactStore {
  readonly emitter = new EventEmitter();

  constructor(private readonly inner: FactStore) {}

  private emit(factId: string, type: ChangeEvent["type"]): void {
    this.emitter.emit("change", { factId, type } satisfies ChangeEvent);
  }

  async assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult> {
    const r = await this.inner.assertFact(input, supersedesId);
    this.emit(r.id, supersedesId ? "superseded" : "created");
    return r;
  }

  async supersedeFact(oldId: string, input: FactInput): Promise<SupersedeResult> {
    const r = await this.inner.supersedeFact(oldId, input);
    this.emit(r.id, "superseded");
    return r;
  }

  async query(opts?: QueryOptions): Promise<QueryResult> {
    return this.inner.query(opts);
  }

  async contradictions(opts?: { subject?: string; predicate?: string }): Promise<ContradictionsResult> {
    return this.inner.contradictions(opts);
  }

  async provenanceChain(rootId: string, maxDepth?: number): Promise<ProvenanceResult> {
    return this.inner.provenanceChain(rootId, maxDepth);
  }

  async list(subject?: string): Promise<string[]> {
    return this.inner.list(subject);
  }

  async show(id: string): Promise<Fact | null> {
    return this.inner.show(id);
  }

  async close(): Promise<void> {
    return this.inner.close?.();
  }
}

// ── FS cross-process watcher (chokidar) ───────────────────────────────────────

export async function attachFsWatcher(
  factsDir: string,
  handler: (event: ChangeEvent) => void,
): Promise<() => void> {
  const chokidar = await import("chokidar");
  const watcher = chokidar.watch(factsDir, {
    persistent: false,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  watcher.on("add", (filePath: string) => {
    if (!filePath.endsWith(".fact.json")) return;
    // Derive the factId from the filename: remove .fact.json, unsluggify : separators
    const basename = filePath.split("/").pop()!.replace(/\.fact\.json$/, "");
    // The filename is slug(id) — we can't recover the exact @id, so emit with
    // the filename as a stand-in; the server will show(id) to get the real fact.
    handler({ factId: basename, type: "created" });
  });

  return () => { watcher.close(); };
}

// ── SQLite cross-process polling ──────────────────────────────────────────────
// Polls a lightweight kndl_changes table every POLL_MS for new rows.
// The table is created lazily; if it doesn't exist the poller does nothing.

export function attachSqlitePoller(
  db: import("better-sqlite3").Database,
  handler: (event: ChangeEvent) => void,
  pollMs = 2000,
): () => void {
  // Create the change-log table if not present
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kndl_changes (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id    TEXT    NOT NULL,
        event_type TEXT    NOT NULL,
        changed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `);
  } catch {
    // read-only connection or other issue — polling won't work
    return () => {};
  }

  let lastSeq: number = (db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS s FROM kndl_changes",
  ).get() as { s: number }).s;

  const timer = setInterval(() => {
    try {
      const rows = db.prepare(
        "SELECT seq, fact_id, event_type FROM kndl_changes WHERE seq > ? ORDER BY seq",
      ).all(lastSeq) as { seq: number; fact_id: string; event_type: string }[];

      for (const r of rows) {
        lastSeq = r.seq;
        handler({ factId: r.fact_id, type: r.event_type as ChangeEvent["type"] });
      }
    } catch {
      // table might have been dropped — ignore
    }
  }, pollMs);

  timer.unref(); // don't prevent process exit

  return () => clearInterval(timer);
}

// Write a change-log entry from within a SqliteFactStore write (called by the store after INSERT).
// Exported so SqliteFactStore can use it without depending on this module at import time.
export function logSqliteChange(
  db: import("better-sqlite3").Database,
  factId: string,
  eventType: ChangeEvent["type"],
): void {
  try {
    db.prepare(
      "INSERT INTO kndl_changes(fact_id, event_type) VALUES (?, ?)",
    ).run(factId, eventType);
  } catch {
    // table doesn't exist yet — fine, poller will create it on attach
  }
}

// ── Subscription registry ─────────────────────────────────────────────────────

export interface SubscribeFilter {
  subject?: string;
  predicate?: string;
  tenant?: string;
}

export interface Subscription {
  id: string;
  filter: SubscribeFilter;
}

export class SubscriptionRegistry {
  private subs = new Map<string, Subscription>();

  add(filter: SubscribeFilter): string {
    const id = randomUUID();
    this.subs.set(id, { id, filter });
    return id;
  }

  remove(id: string): boolean {
    return this.subs.delete(id);
  }

  list(): Subscription[] {
    return [...this.subs.values()];
  }

  matches(fact: Partial<{ subject: string; predicate: string; tenant: string }>): Subscription[] {
    return [...this.subs.values()].filter((s) => {
      if (s.filter.subject   && s.filter.subject   !== fact.subject)   return false;
      if (s.filter.predicate && s.filter.predicate !== fact.predicate) return false;
      if (s.filter.tenant    && s.filter.tenant    !== fact.tenant)    return false;
      return true;
    });
  }

  get size(): number { return this.subs.size; }
}
