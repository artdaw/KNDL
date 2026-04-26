// stores/supabase.ts — SupabaseFactStore: multi-tenant cloud store.
//
// Requires: @supabase/supabase-js  (npm install @supabase/supabase-js)
// RLS enforces tenant isolation. Realtime change feed available via Supabase.
//
// Prerequisites — run once in your Supabase project:
//
//   CREATE TABLE facts (
//     id             TEXT PRIMARY KEY,
//     fact_json      JSONB NOT NULL,
//     subject        TEXT,
//     predicate      TEXT,
//     confidence     FLOAT8 NOT NULL,
//     recorded_at    TIMESTAMPTZ NOT NULL,
//     supersedes     TEXT,
//     tenant         TEXT,
//     classification TEXT
//   );
//   CREATE INDEX ON facts(subject);
//   CREATE INDEX ON facts(predicate);
//   CREATE INDEX ON facts(confidence);
//   CREATE INDEX ON facts(recorded_at);
//   CREATE INDEX ON facts(supersedes);
//   CREATE INDEX ON facts(tenant);
//   ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
//   -- Add your own RLS policies for tenant isolation.

import type { Fact, FactInput, FactStore, QueryOptions, QueryResult,
  ContradictionsResult, ProvenanceResult, AssertResult, SupersedeResult } from "../types.js";
import {
  buildFact, applyQuery, findContradictions, buildProvenanceChain,
} from "../core.js";

const CONTEXT_URL = "https://kndl.artdaw.com/context/v1.jsonld";

export class SupabaseFactStore implements FactStore {
  private client!: import("@supabase/supabase-js").SupabaseClient;
  private ready: Promise<void>;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.ready = this._init(supabaseUrl, supabaseKey);
  }

  private async _init(url: string, key: string): Promise<void> {
    let mod: typeof import("@supabase/supabase-js");
    try {
      mod = await import("@supabase/supabase-js");
    } catch {
      throw new Error("Supabase not installed: npm install @supabase/supabase-js");
    }
    this.client = mod.createClient(url, key);
  }

  private async loadAll(): Promise<Fact[]> {
    await this.ready;
    const { data, error } = await this.client.from("facts").select("fact_json");
    if (error) throw new Error(`Supabase loadAll: ${error.message}`);
    return (data ?? []).map((r: { fact_json: unknown }) => r.fact_json as Fact);
  }

  async assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult> {
    await this.ready;
    const fact = buildFact(input, CONTEXT_URL, supersedesId);
    const { error } = await this.client.from("facts").insert({
      id:             fact["@id"],
      fact_json:      fact,
      subject:        fact.subject ?? null,
      predicate:      fact.predicate ?? null,
      confidence:     fact.confidence,
      recorded_at:    fact.recordedAt,
      supersedes:     fact.supersedes ?? null,
      tenant:         fact.tenant ?? null,
      classification: fact.classification ?? null,
    });
    if (error) throw new Error(`Supabase assertFact: ${error.message}`);
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
    let q = this.client.from("facts").select("id");
    if (subject) q = q.eq("subject", subject);
    const { data, error } = await q;
    if (error) throw new Error(`Supabase list: ${error.message}`);
    return (data ?? []).map((r: { id: string }) => r.id);
  }

  async show(id: string): Promise<Fact | null> {
    await this.ready;
    const { data, error } = await this.client
      .from("facts")
      .select("fact_json")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase show: ${error.message}`);
    return data ? (data.fact_json as Fact) : null;
  }
}
