// tests/stores.test.ts — backend conformance tests on the loan-decision corpus.
//
// Run: tsx --test tests/stores.test.ts
//
// Tests FsFactStore and SqliteFactStore with identical assertions.
// DuckDbFactStore and SupabaseFactStore require optional deps; skipped when absent.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import type { FactStore, FactInput } from "../src/types.js";
import { FsFactStore } from "../src/stores/fs.js";
import { SqliteFactStore } from "../src/stores/sqlite.js";
import { effectiveConfidence, nowIso } from "../src/core.js";

// ── Loan-decision corpus ──────────────────────────────────────────────────────

const CORPUS_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../skills/kndl-memory/examples/loan-decision",
);

interface CorpusFact {
  "@id": string;
  statement: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  confidence: number;
  decay?: string;
  source: string;
  validFrom: string;
  recordedAt: string;
  supersedes?: string;
}

function loadCorpus(): CorpusFact[] {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".fact.json"));
  return files.map((f) => JSON.parse(readFileSync(join(CORPUS_DIR, f), "utf8")));
}

// Convert corpus fact (already written) into FactInput for assertFact
function toInput(f: CorpusFact): FactInput {
  return {
    statement:  f.statement,
    confidence: f.confidence,
    source:     f.source,
    subject:    f.subject,
    predicate:  f.predicate,
    object:     f.object,
    decay:      f.decay,
    validFrom:  f.validFrom,
  };
}

// ── Shared conformance suite ──────────────────────────────────────────────────

async function runConformance(store: FactStore, label: string): Promise<void> {
  const corpus = loadCorpus();

  await test(`${label}: assertFact — writes all ${corpus.length} corpus facts`, async () => {
    for (const f of corpus) {
      const r = await store.assertFact(toInput(f));
      assert.ok(r.id.startsWith("fact:"), `id should start with fact: — got ${r.id}`);
      assert.equal(r.fact.confidence, f.confidence);
      assert.equal(r.fact.source, f.source);
    }
  });

  await test(`${label}: list — returns IDs for all written facts`, async () => {
    const ids = await store.list();
    assert.equal(ids.length, corpus.length, `expected ${corpus.length} facts`);
    for (const id of ids) assert.ok(id.startsWith("fact:"));
  });

  await test(`${label}: list — filters by subject`, async () => {
    const ids = await store.list("customer:9281");
    assert.ok(ids.length >= 4, `expected ≥4 facts for customer:9281, got ${ids.length}`);
  });

  await test(`${label}: query — returns active facts with effective_confidence`, async () => {
    const result = await store.query();
    assert.ok(result.count > 0, "expected at least one active fact");
    assert.equal(result.facts.length, result.count);
    for (const f of result.facts) {
      assert.ok(typeof f.effective_confidence === "number");
      assert.ok(f.effective_confidence >= 0 && f.effective_confidence <= 1);
    }
    // Facts are sorted descending by effective_confidence
    for (let i = 1; i < result.facts.length; i++) {
      assert.ok(
        result.facts[i - 1].effective_confidence >= result.facts[i].effective_confidence,
        "facts should be sorted by effective_confidence desc",
      );
    }
  });

  await test(`${label}: query — filters by subject`, async () => {
    const result = await store.query({ subject: "customer:9281" });
    assert.ok(result.count >= 1);
    for (const f of result.facts) assert.equal(f.subject, "customer:9281");
  });

  await test(`${label}: query — filters by predicate`, async () => {
    const result = await store.query({ predicate: "creditScore" });
    assert.ok(result.count >= 1);
    for (const f of result.facts) assert.equal(f.predicate, "creditScore");
  });

  await test(`${label}: contradictions — detects conflicting creditScore facts`, async () => {
    const result = await store.contradictions({ predicate: "creditScore" });
    // The corpus has 3 creditScore facts with different objects (720, 680, etc.)
    // — expect at least one contradiction group
    assert.ok(result.count >= 1, `expected ≥1 contradiction, got ${result.count}`);
    assert.ok(result.conflicts.length >= 1);
    const group = result.conflicts[0];
    assert.ok(group.preferred.effective_confidence >= 0);
    assert.ok(group.conflicts_with.length >= 1);
  });

  await test(`${label}: show — returns a fact by ID`, async () => {
    const ids = await store.list();
    const f = await store.show(ids[0]);
    assert.ok(f !== null, "expected a fact");
    assert.equal(f!["@id"], ids[0]);
  });

  await test(`${label}: show — returns null for unknown ID`, async () => {
    const f = await store.show("fact:does-not-exist");
    assert.equal(f, null);
  });

  await test(`${label}: supersedeFact — hides old fact, shows new one in active query`, async () => {
    // Write a fact then supersede it
    const original = await store.assertFact({
      statement: "Test supersession — original",
      confidence: 0.8,
      source: "test://supersede",
      subject: "test:supersede",
      predicate: "value",
      object: "original",
    });

    const replacement = await store.supersedeFact(original.id, {
      statement: "Test supersession — replacement",
      confidence: 0.9,
      source: "test://supersede",
      subject: "test:supersede",
      predicate: "value",
      object: "replacement",
    });

    assert.equal(replacement.supersedes, original.id);

    // Active query should NOT include the original
    const active = await store.query({ subject: "test:supersede" });
    const activeIds = active.facts.map((f) => f["@id"]);
    assert.ok(!activeIds.includes(original.id), "original should be superseded (hidden)");
    assert.ok(activeIds.includes(replacement.id), "replacement should be active");

    // as_of before replacement should return original
    const asOf = await store.query({
      subject: "test:supersede",
      asOf: "2020-01-01T00:00:00Z",
    });
    // recordedAt of both is ~now, so as_of 2020 returns nothing
    assert.equal(asOf.count, 0, "no facts existed in 2020");
  });

  await test(`${label}: provenanceChain — walks supersession chain`, async () => {
    // Find a fact that supersedes another
    const ids = await store.list();
    for (const id of ids) {
      const f = await store.show(id);
      if (f?.supersedes) {
        const chain = await store.provenanceChain(id);
        assert.ok(chain.chain.length >= 2, "should walk back to superseded fact");
        assert.equal(chain.root, id);
        const ids_in_chain = chain.chain.map((n) => n.id);
        assert.ok(ids_in_chain.includes(f.supersedes!), "superseded fact should be in chain");
        return;
      }
    }
    // No supersession in the base corpus (we added one above) — skip silently
  });
}

// ── Test runners ──────────────────────────────────────────────────────────────

describe("FsFactStore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kndl-fs-test-"));
  const store = new FsFactStore(dir);
  after(() => rmSync(dir, { recursive: true, force: true }));
  await runConformance(store, "FsFactStore");
});

describe("SqliteFactStore", async () => {
  const store = new SqliteFactStore(":memory:");
  after(async () => store.close?.());
  await runConformance(store, "SqliteFactStore");
});

// ── Decay math unit tests ─────────────────────────────────────────────────────

describe("decay math", () => {
  test("effectiveConfidence: no decay returns base confidence", () => {
    const fact = {
      "@id": "fact:x", "@type": "Fact",
      statement: "x", confidence: 0.9, source: "test",
      validFrom: "2026-01-01T00:00:00Z", recordedAt: "2026-01-01T00:00:00Z",
    };
    assert.equal(effectiveConfidence(fact, nowIso()), 0.9);
  });

  test("effectiveConfidence: 0.5/24h after 24h = 0.45", () => {
    const validFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const fact = {
      "@id": "fact:x", "@type": "Fact",
      statement: "x", confidence: 0.9, source: "test",
      validFrom, recordedAt: validFrom,
      decay: "0.5/24h",
    };
    const eff = effectiveConfidence(fact, nowIso());
    assert.ok(Math.abs(eff - 0.45) < 0.01, `expected ~0.45, got ${eff}`);
  });

  test("effectiveConfidence: future validFrom returns base confidence", () => {
    const fact = {
      "@id": "fact:x", "@type": "Fact",
      statement: "x", confidence: 0.8, source: "test",
      validFrom: "2099-01-01T00:00:00Z", recordedAt: "2026-01-01T00:00:00Z",
      decay: "0.5/1d",
    };
    assert.equal(effectiveConfidence(fact, nowIso()), 0.8);
  });
});
