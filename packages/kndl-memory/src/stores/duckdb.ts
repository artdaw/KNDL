// stores/duckdb.ts — DuckDbFactStore: columnar store for analytical workloads.
//
// Requires: @duckdb/node-api  (npm install @duckdb/node-api)
// Fast for AVG(effective_confidence) GROUP BY predicate, bulk imports, etc.

import { resolve } from "node:path";

import type { Fact, FactInput, FactStore, QueryOptions, QueryResult,
  ContradictionsResult, ProvenanceResult, AssertResult, SupersedeResult } from "../types.js";
import {
  buildFact, applyQuery, findContradictions, buildProvenanceChain,
} from "../core.js";

const CONTEXT_URL = "https://kndl.artdaw.com/context/v1.jsonld";

const DDL = `
CREATE TABLE IF NOT EXISTS facts (
  id             VARCHAR PRIMARY KEY,
  fact_json      VARCHAR NOT NULL,
  subject        VARCHAR,
  predicate      VARCHAR,
  confidence     DOUBLE NOT NULL,
  recorded_at    VARCHAR NOT NULL,
  supersedes     VARCHAR,
  tenant         VARCHAR,
  classification VARCHAR
);
`;

interface DuckDBConnection {
  run(sql: string, ...params: any[]): Promise<any>;
  prepare(sql: string): Promise<any>;
  close?(): void;
}

interface DuckDBModule {
  DuckDBInstance: {
    create(path: string): Promise<{ connect(): Promise<DuckDBConnection> }>;
  };
}

export class DuckDbFactStore implements FactStore {
  private conn!: DuckDBConnection;
  private ready: Promise<void>;

  constructor(dbPath: string) {
    this.ready = this._init(dbPath === ":memory:" ? ":memory:" : resolve(dbPath));
  }

  private async _init(path: string): Promise<void> {
    let mod: DuckDBModule;
    try {
      mod = await import("@duckdb/node-api");
    } catch {
      throw new Error("DuckDB not installed: npm install @duckdb/node-api");
    }
    const instance = await mod.DuckDBInstance.create(path);
    this.conn = await instance.connect();
    await this.conn.run(DDL);
  }

  private async loadAll(): Promise<Fact[]> {
    await this.ready;
    const result = await this.conn.run("SELECT fact_json FROM facts");
    const rows = await result.getRows();
    return rows.map((r) => JSON.parse(r[0] as string) as Fact);
  }

  async assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult> {
    await this.ready;
    const fact = buildFact(input, CONTEXT_URL, supersedesId);
    const stmt = await this.conn.prepare(
      `INSERT INTO facts (id, fact_json, subject, predicate, confidence,
         recorded_at, supersedes, tenant, classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await stmt.run(
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
    return applyQuery(await this.loadAll(), opts ?? {});
  }

  async contradictions(opts?: { subject?: string; predicate?: string }): Promise<ContradictionsResult> {
    return findContradictions(await this.loadAll(), opts ?? {});
  }

  async provenanceChain(rootId: string, maxDepth?: number): Promise<ProvenanceResult> {
    const facts = await this.loadAll();
    const byId = new Map(facts.map((f) => [f["@id"], f]));
    return buildProvenanceChain(byId, rootId, maxDepth);
  }

  async list(subject?: string): Promise<string[]> {
    await this.ready;
    const sql = subject ? "SELECT id FROM facts WHERE subject = ?" : "SELECT id FROM facts";
    const result = subject
      ? await (await this.conn.prepare(sql)).run(subject)
      : await this.conn.run(sql);
    const rows = await result.getRows();
    return rows.map((r) => r[0] as string);
  }

  async show(id: string): Promise<Fact | null> {
    await this.ready;
    const stmt = await this.conn.prepare("SELECT fact_json FROM facts WHERE id = ?");
    const result = await stmt.run(id);
    const rows = await result.getRows();
    return rows.length ? JSON.parse(rows[0][0] as string) as Fact : null;
  }

  async close(): Promise<void> {
    await this.ready;
    // DuckDB Node API connection cleanup
    this.conn.close?.();
  }
}
