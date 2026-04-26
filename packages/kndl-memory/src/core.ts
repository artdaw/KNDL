// core.ts — KNDL fact store: shared between CLI and MCP server.
//
// Pure logic, except for the FS layer at the bottom. Decay math is in `effectiveConfidence`.
// Storage format: one JSON-LD file per fact under $KNDL_MEMORY_DIR/facts/, immutable
// once written; updates happen via `supersedeFact`.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ───────────────────────── types ──────────────────────────

export interface Fact {
  "@context"?: string;
  "@id": string;
  "@type": string;
  statement: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  confidence: number;
  decay?: string;
  source: string;
  validFrom: string;
  validUntil?: string;
  observedAt?: string;
  recordedAt: string;
  supersedes?: string;
  derivedFrom?: string[];
  inference?: string;
  negated?: boolean;
  classification?: string;
  consent?: string;
  retention?: string;
  tenant?: string;
  signature?: unknown;
  weight?: number;
  tags?: string[];
}

export interface FactInput {
  statement: string;
  confidence: number;
  source: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  decay?: string;
  validFrom?: string;
  validUntil?: string;
  observedAt?: string;
  classification?: string;
  consent?: string;
  tenant?: string;
  derivedFrom?: string[];
  negated?: boolean;
}

export interface QueryOptions {
  subject?: string;
  predicate?: string;
  asOf?: string;
  minConfidence?: number;
  tenant?: string;
  allowPhi?: boolean;
}

export interface QueryResultFact extends Fact {
  effective_confidence: number;
}

export interface QueryResult {
  as_of: string;
  count: number;
  facts: QueryResultFact[];
}

export interface ContradictionEntry {
  subject: string | undefined;
  predicate: string | undefined;
  preferred: { id: string; object: unknown; negated: boolean; effective_confidence: number };
  conflicts_with: { id: string; object: unknown; negated: boolean; effective_confidence: number }[];
}

export interface ProvenanceNode {
  id: string;
  statement?: string;
  source?: string;
  confidence?: number;
  recordedAt?: string;
  derivedFrom?: string[];
  supersedes?: string;
  missing?: boolean;
}

// ───────────────────────── decay math ──────────────────────────

const UNIT_SECONDS: Record<string, number> = {
  ns: 1e-9, us: 1e-6, ms: 1e-3,
  s: 1, m: 60, h: 3600,
  d: 86_400, w: 7 * 86_400,
  mo: 30 * 86_400, y: 365 * 86_400,
};

const DUR_RE = /^(\d+(?:\.\d+)?)(ns|us|ms|s|m|h|d|w|mo|y)$/;

export function parseDurationSeconds(s: string): number {
  const m = DUR_RE.exec(s.trim());
  if (!m) throw new Error(`bad duration: ${JSON.stringify(s)}`);
  return parseFloat(m[1]) * UNIT_SECONDS[m[2]];
}

export interface DecaySpec { rate: number; windowSeconds: number; }

export function parseDecay(decay: string | null | undefined): DecaySpec | null {
  if (!decay) return null;
  if (!decay.includes("/")) throw new Error(`bad decay (need rate/window): ${decay}`);
  const [rateStr, windowStr] = decay.split("/", 2);
  const rate = parseFloat(rateStr);
  const windowSeconds = parseDurationSeconds(windowStr);
  if (!(rate > 0 && rate < 1)) throw new Error(`decay rate must be in (0,1): ${rate}`);
  if (!(windowSeconds > 0)) throw new Error(`decay window must be positive: ${windowSeconds}`);
  return { rate, windowSeconds };
}

export function effectiveConfidence(fact: Fact, atIso: string): number {
  const base = fact.confidence ?? 0;
  const spec = parseDecay(fact.decay);
  if (!spec) return base;
  const anchorIso = fact.validFrom ?? fact.observedAt ?? fact.recordedAt;
  if (!anchorIso) return base;
  const elapsed = (new Date(atIso).getTime() - new Date(anchorIso).getTime()) / 1000;
  if (elapsed <= 0) return base;
  return base * Math.pow(spec.rate, elapsed / spec.windowSeconds);
}

// ───────────────────────── time utils ──────────────────────────

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function normalizeTime(s: string | undefined, fallback: string): string {
  if (!s || s === "now") return fallback;
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error(`bad datetime: ${s}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ───────────────────────── filesystem layer ──────────────────────────

export class FactStore {
  readonly memoryDir: string;
  readonly factsDir: string;
  readonly contextRel: string;

  constructor(memoryDir: string, contextRel = "../context/v1.jsonld") {
    this.memoryDir = memoryDir;
    this.factsDir = join(memoryDir, "facts");
    this.contextRel = contextRel;
  }

  ensureDirs(): void {
    mkdirSync(this.factsDir, { recursive: true });
  }

  loadAll(): Fact[] {
    if (!existsSync(this.factsDir)) return [];
    const files = readdirSync(this.factsDir).filter((f) => f.endsWith(".fact.json"));
    const out: Fact[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(join(this.factsDir, f), "utf8")));
      } catch (e) {
        process.stderr.write(`warning: skipping ${f}: ${(e as Error).message}\n`);
      }
    }
    return out;
  }

  supersededIds(facts: Fact[] = this.loadAll()): Set<string> {
    const out = new Set<string>();
    for (const f of facts) if (f.supersedes) out.add(f.supersedes);
    return out;
  }

  // ─── write ──

  assertFact(input: FactInput, supersedesId?: string): { id: string; path: string; fact: Fact } {
    this.ensureDirs();
    if (!(input.confidence >= 0 && input.confidence <= 1)) {
      throw new Error(`confidence must be in [0,1]: ${input.confidence}`);
    }
    if (input.decay) parseDecay(input.decay);

    const recordedAt = nowIso();
    const validFrom = normalizeTime(input.validFrom, recordedAt);
    const id = makeId(input.subject, input.predicate, input.statement);

    const fact: Fact = {
      "@context": this.contextRel,
      "@id": id,
      "@type": "Fact",
      statement: input.statement,
      confidence: input.confidence,
      source: input.source,
      validFrom,
      recordedAt,
    };
    if (input.observedAt) fact.observedAt = normalizeTime(input.observedAt, recordedAt);
    if (input.validUntil) fact.validUntil = normalizeTime(input.validUntil, recordedAt);
    if (input.subject) fact.subject = input.subject;
    if (input.predicate) fact.predicate = input.predicate;
    if (input.object !== undefined) fact.object = input.object;
    if (input.decay) fact.decay = input.decay;
    if (input.classification) fact.classification = input.classification;
    if (input.consent) fact.consent = input.consent;
    if (input.tenant) fact.tenant = input.tenant;
    if (input.derivedFrom) fact.derivedFrom = input.derivedFrom;
    if (input.negated) fact.negated = true;
    if (supersedesId) fact.supersedes = supersedesId;

    const fname = factFilename(fact["@id"]);
    const path = join(this.factsDir, fname);
    if (existsSync(path)) {
      throw new Error(`refusing to overwrite ${path}; facts are immutable`);
    }
    writeFileSync(path, JSON.stringify(fact, null, 2));
    return { id, path, fact };
  }

  supersedeFact(oldId: string, input: FactInput): { id: string; path: string; supersedes: string; fact: Fact } {
    const out = this.assertFact(input, oldId);
    return { ...out, supersedes: oldId };
  }

  // ─── read ──

  query(opts: QueryOptions = {}): QueryResult {
    const facts = this.loadAll();
    const superseded = this.supersededIds(facts);
    const asOf = normalizeTime(opts.asOf, nowIso());
    const asOfMs = new Date(asOf).getTime();
    const minConf = opts.minConfidence ?? 0;

    const rows: QueryResultFact[] = facts
      .filter((f) => !superseded.has(f["@id"]))
      .filter((f) => factMatches(f, opts.subject, opts.predicate))
      .filter((f) => !opts.tenant || f.tenant === opts.tenant)
      .filter((f) => new Date(f.recordedAt).getTime() <= asOfMs)
      .filter((f) => !(f.classification === "PHI" && !opts.allowPhi))
      .map((f) => ({
        ...f,
        effective_confidence: round4(effectiveConfidence(f, asOf)),
      }))
      .filter((f) => f.effective_confidence >= minConf)
      .sort((a, b) => b.effective_confidence - a.effective_confidence);

    return { as_of: asOf, count: rows.length, facts: rows };
  }

  contradictions(opts: { subject?: string; predicate?: string } = {}): { count: number; conflicts: ContradictionEntry[] } {
    const facts = this.loadAll();
    const superseded = this.supersededIds(facts);
    const asOf = nowIso();

    const groups = new Map<string, Fact[]>();
    for (const f of facts) {
      if (superseded.has(f["@id"])) continue;
      if (!factMatches(f, opts.subject, opts.predicate)) continue;
      const key = JSON.stringify([f.subject ?? null, f.predicate ?? null]);
      let bucket = groups.get(key);
      if (!bucket) groups.set(key, bucket = []);
      bucket.push(f);
    }

    const conflicts: ContradictionEntry[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const distinct = new Set(group.map((g) => JSON.stringify([g.object ?? null, !!g.negated])));
      if (distinct.size <= 1) continue;
      const ranked = [...group].sort((a, b) => {
        const an = a.negated ? 1 : 0, bn = b.negated ? 1 : 0;
        if (an !== bn) return an - bn;
        const ar = new Date(a.recordedAt).getTime(), br = new Date(b.recordedAt).getTime();
        if (ar !== br) return br - ar;
        const ae = effectiveConfidence(a, asOf), be = effectiveConfidence(b, asOf);
        if (ae !== be) return be - ae;
        return (a.derivedFrom?.length ?? 0) - (b.derivedFrom?.length ?? 0);
      });
      conflicts.push({
        subject: ranked[0].subject,
        predicate: ranked[0].predicate,
        preferred: {
          id: ranked[0]["@id"],
          object: ranked[0].object ?? null,
          negated: ranked[0].negated ?? false,
          effective_confidence: round4(effectiveConfidence(ranked[0], asOf)),
        },
        conflicts_with: ranked.slice(1).map((g) => ({
          id: g["@id"],
          object: g.object ?? null,
          negated: g.negated ?? false,
          effective_confidence: round4(effectiveConfidence(g, asOf)),
        })),
      });
    }
    return { count: conflicts.length, conflicts };
  }

  provenanceChain(rootId: string, maxDepth = 8): { root: string; depth: number; chain: ProvenanceNode[] } {
    const facts = this.loadAll();
    const byId = new Map(facts.map((f) => [f["@id"], f]));
    const visited = new Set<string>();
    const chain: ProvenanceNode[] = [];

    const walk = (id: string, depth: number): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const f = byId.get(id);
      if (!f) {
        chain.push({ id, missing: true });
        return;
      }
      chain.push({
        id: f["@id"],
        statement: f.statement,
        source: f.source,
        confidence: f.confidence,
        recordedAt: f.recordedAt,
        derivedFrom: f.derivedFrom ?? [],
        supersedes: f.supersedes,
      });
      for (const ref of f.derivedFrom ?? []) walk(ref, depth + 1);
      if (f.supersedes) walk(f.supersedes, depth + 1);
    };

    walk(rootId, 0);
    return { root: rootId, depth: chain.length, chain };
  }

  list(subject?: string): string[] {
    const facts = this.loadAll();
    const filtered = subject ? facts.filter((f) => f.subject === subject) : facts;
    return filtered.map((f) => f["@id"]);
  }

  show(id: string): Fact | null {
    return this.loadAll().find((f) => f["@id"] === id) ?? null;
  }
}

// ───────────────────────── helpers ──────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "fact";
}

function makeId(subject: string | undefined, predicate: string | undefined, statement: string): string {
  const ts = nowIso().replace(/[-:]/g, "");
  const h = createHash("sha256").update(statement).digest("hex").slice(0, 8);
  const parts = ["fact"];
  if (subject) parts.push(slugify(subject));
  if (predicate) parts.push(slugify(predicate));
  return `${parts.join(":")}-${ts}-${h}`;
}

function factFilename(id: string): string {
  return slugify(id.replace(/:/g, "-")) + ".fact.json";
}

function factMatches(f: Fact, subject?: string, predicate?: string): boolean {
  if (subject && f.subject !== subject) return false;
  if (predicate && f.predicate !== predicate) return false;
  return true;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
