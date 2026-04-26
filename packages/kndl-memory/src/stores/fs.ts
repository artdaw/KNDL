// stores/fs.ts — FsFactStore: one JSON-LD file per fact.
//
// Storage: {memoryDir}/facts/*.fact.json
// Source of truth when running inside Anthropic Memory (filesystem mount).
// Synchronous FS calls wrapped in Promises so it satisfies the async FactStore interface.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Fact, FactInput, FactStore, QueryOptions, QueryResult,
  ContradictionsResult, ProvenanceResult, AssertResult, SupersedeResult } from "../types.js";
import {
  buildFact, factFilename, applyQuery, findContradictions, buildProvenanceChain,
  supersededIds,
} from "../core.js";

const CONTEXT_REL = "../context/v1.jsonld";

export class FsFactStore implements FactStore {
  readonly memoryDir: string;
  readonly factsDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = resolve(memoryDir);
    this.factsDir  = join(this.memoryDir, "facts");
  }

  private ensureDirs(): void {
    mkdirSync(this.factsDir, { recursive: true });
  }

  private loadAll(): Fact[] {
    if (!existsSync(this.factsDir)) return [];
    const out: Fact[] = [];
    for (const f of readdirSync(this.factsDir).filter((f) => f.endsWith(".fact.json"))) {
      try {
        out.push(JSON.parse(readFileSync(join(this.factsDir, f), "utf8")));
      } catch (e) {
        process.stderr.write(`warning: skipping ${f}: ${(e as Error).message}\n`);
      }
    }
    return out;
  }

  async assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult> {
    this.ensureDirs();
    const fact = buildFact(input, CONTEXT_REL, supersedesId);
    const path = join(this.factsDir, factFilename(fact["@id"]));
    if (existsSync(path)) throw new Error(`refusing to overwrite ${path}; facts are immutable`);
    writeFileSync(path, JSON.stringify(fact, null, 2));
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
    const facts = this.loadAll();
    return (subject ? facts.filter((f) => f.subject === subject) : facts)
      .map((f) => f["@id"]);
  }

  async show(id: string): Promise<Fact | null> {
    return this.loadAll().find((f) => f["@id"] === id) ?? null;
  }
}
