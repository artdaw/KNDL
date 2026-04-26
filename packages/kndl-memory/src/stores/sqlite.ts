// stores/sqlite.ts — SqliteFactStore: single-file persistent store (DEFAULT).
//
// Schema: one row per fact. Key columns indexed for fast queries.
// The full fact JSON is stored in fact_json for lossless round-trip.
// WAL journal mode enabled for concurrent read access.
//
// Requires: better-sqlite3

import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import type { Fact, FactInput, FactStore, QueryOptions, QueryResult,
  ContradictionsResult, ProvenanceResult, AssertResult, SupersedeResult } from "../types.js";
import {
  buildFact, applyQuery, findContradictions, buildProvenanceChain,
} from "../core.js";

const CONTEXT_URL = "https://kndl.artdaw.com/context/v1.jsonld";

const DDL = `
CREATE TABLE IF NOT EXISTS facts (
  id             TEXT PRIMARY KEY,
  fact_json      TEXT NOT NULL,
  subject        TEXT,
  predicate      TEXT,
  confidence     REAL NOT NULL,
  recorded_at    TEXT NOT NULL,
  supersedes     TEXT,
  tenant         TEXT,
  classification TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_subject       ON facts(subject);
CREATE INDEX IF NOT EXISTS idx_facts_predicate     ON facts(predicate);
CREATE INDEX IF NOT EXISTS idx_facts_confidence    ON facts(confidence);
CREATE INDEX IF NOT EXISTS idx_facts_recorded_at   ON facts(recorded_at);
CREATE INDEX IF NOT EXISTS idx_facts_supersedes    ON facts(supersedes);
CREATE INDEX IF NOT EXISTS idx_facts_tenant        ON facts(tenant);
`;

export class SqliteFactStore implements FactStore {
  private db: import("better-sqlite3").Database;

  constructor(dbPath: string) {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const path = dbPath === ":memory:" ? dbPath : resolve(dbPath);
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    for (const stmt of DDL.trim().split(";").map((s) => s.trim()).filter(Boolean)) {
      this.db.exec(stmt);
    }
  }

  private loadAll(): Fact[] {
    return (this.db.prepare("SELECT fact_json FROM facts").all() as { fact_json: string }[])
      .map((r) => JSON.parse(r.fact_json) as Fact);
  }

  async assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult> {
    const fact = buildFact(input, CONTEXT_URL, supersedesId);
    this.db.prepare(
      `INSERT INTO facts (id, fact_json, subject, predicate, confidence,
         recorded_at, supersedes, tenant, classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fact["@id"],
      JSON.stringify(fact),
      fact.subject ?? null,
      fact.predicate ?? null,
      fact.confidence,
      fact.recordedAt,
      fact.supersedes ?? null,
      fact.tenant ?? null,
      fact.classification ?? null,
    );
    return { id: fact["@id"], fact };
  }

  async supersedeFact(oldId: string, input: FactInput): Promise<SupersedeResult> {
    const { id, fact } = await this.assertFact(input, oldId);
    return { id, fact, supersedes: oldId };
  }

  async query(opts?: QueryOptions): Promise<QueryResult> {
    return applyQuery(this.loadAll(), opts ?? {});
  }

  async contradictions(opts?: { subject?: string; predicate?: string }): Promise<ContradictionsResult> {
    return findContradictions(this.loadAll(), opts ?? {});
  }

  async provenanceChain(rootId: string, maxDepth?: number): Promise<ProvenanceResult> {
    const facts = this.loadAll();
    const byId = new Map(facts.map((f) => [f["@id"], f]));
    return buildProvenanceChain(byId, rootId, maxDepth);
  }

  async list(subject?: string): Promise<string[]> {
    if (subject) {
      return (this.db.prepare("SELECT id FROM facts WHERE subject = ?").all(subject) as { id: string }[])
        .map((r) => r.id);
    }
    return (this.db.prepare("SELECT id FROM facts").all() as { id: string }[]).map((r) => r.id);
  }

  async show(id: string): Promise<Fact | null> {
    const row = this.db.prepare("SELECT fact_json FROM facts WHERE id = ?").get(id) as { fact_json: string } | undefined;
    return row ? JSON.parse(row.fact_json) as Fact : null;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
