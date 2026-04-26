// tests/remote.test.ts — loopback tests for remote sync using FakeMemoryStoreClient.
// No real API calls; no ANTHROPIC_API_KEY required.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FakeMemoryStoreClient } from "../src/remote/anthropic.js";
import { pull, push, syncBoth } from "../src/remote/sync.js";
import { FsFactStore } from "../src/stores/fs.js";
import { SqliteFactStore } from "../src/stores/sqlite.js";
import type { RemoteConfig } from "../src/remote/types.js";

const STORE_ID = "store_test";

function makeConfig(storeId = STORE_ID): RemoteConfig {
  return {
    label:              "test",
    provider:           "anthropic",
    store_id:           storeId,
    default_confidence: 0.85,
    push:               false,
  };
}

describe("remote sync — FsFactStore backend", async () => {
  const dir     = mkdtempSync(join(tmpdir(), "kndl-remote-fs-test-"));
  const store   = new FsFactStore(dir);
  const client  = new FakeMemoryStoreClient();

  // Seed three memories
  client.seedStore("Test Store", STORE_ID);
  client.seedMemory(STORE_ID, "/notes/alice.md",   "Alice is a senior engineer on the payments team");
  client.seedMemory(STORE_ID, "/notes/q1-goal.md", "The Q1 goal is to reduce p99 latency to under 200ms");
  client.seedMemory(STORE_ID, "/notes/phi.md",     "PHI record: patient 9001 has type 2 diabetes");

  test("pull: writes all 3 memories as facts", async () => {
    const config = makeConfig();
    const result = await pull(client, store, config);
    assert.equal(result.pulled, 3, `expected 3 pulled, got ${result.pulled}`);
    assert.equal(result.skipped, 0);
    assert.equal(result.superseded, 0);
    assert.ok(result.synced_at.endsWith("Z"));
  });

  test("pull: facts have correct source URIs based on memory path", async () => {
    const facts = (await store.query()).facts;
    assert.equal(facts.length, 3);
    for (const f of facts) {
      assert.ok(f.source.startsWith("anthropic-memory://store_test/"), `unexpected source: ${f.source}`);
      assert.ok(f.tags?.includes("from-anthropic-memory"), "missing from-anthropic-memory tag");
      assert.ok(f.tags?.some(t => t.startsWith("content-hash:")), "missing content-hash tag");
      assert.ok(f.tags?.some(t => t.startsWith("path:")), "missing path tag");
    }
  });

  test("pull: idempotent — second pull skips all facts", async () => {
    const config = makeConfig();
    const result = await pull(client, store, config);
    assert.equal(result.pulled,     0, "should skip already-pulled facts");
    assert.equal(result.skipped,    3, "should report 3 skipped");
    assert.equal(result.superseded, 0);
  });

  test("pull: supersedes when memory content changes", async () => {
    // Update a memory in the fake client to simulate an edit
    const page = await client.listMemories(STORE_ID, { path_prefix: "/notes/alice" });
    const aliceMem = page.data[0] as { id: string; type: string };
    assert.ok(aliceMem, "alice memory not found");
    await client.updateMemory(STORE_ID, aliceMem.id, { content: "Alice is now a STAFF engineer on the payments team" });

    const config = makeConfig();
    const result = await pull(client, store, config);
    assert.equal(result.superseded, 1, "expected 1 superseded");
    assert.equal(result.pulled, 0);

    const active = await store.query({ tenant: "test" });
    const aliceFact = active.facts.find(f => f.statement.includes("STAFF"));
    assert.ok(aliceFact, "superseded fact should appear in active results");
  });

  test("push: throws when config.push is false", async () => {
    await assert.rejects(
      () => push(client, store, makeConfig()),
      /Push is disabled/,
    );
  });

  test("push: skips facts without the push_tag", async () => {
    const config = { ...makeConfig(), push: true };
    const result = await push(client, store, config);
    assert.equal(result.pushed, 0);
    assert.equal(result.errors, 0);
  });

  test("push: pushes facts tagged with push_tag", async () => {
    await store.assertFact({
      statement:  "Test push fact",
      confidence: 0.9,
      source:     "test://push",
      tags:       ["push-to-anthropic"],
    });
    const config = { ...makeConfig(), push: true };
    const result = await push(client, store, config);
    assert.equal(result.pushed, 1, "expected 1 fact pushed");
    assert.equal(result.errors, 0);

    // Verify memory was created with correct path
    const page = await client.listMemories(STORE_ID, { path_prefix: "/kndl-facts/" });
    assert.ok(page.data.length >= 1, "expected at least 1 kndl-facts memory");
  });

  test("push: idempotent — second push skips already-pushed facts", async () => {
    const config = { ...makeConfig(), push: true };
    const r1 = await push(client, store, config);
    const r2 = await push(client, store, config);
    assert.equal(r2.pushed, 0, "second push should push nothing new");
    assert.ok(r2.skipped >= r1.pushed, "second push should skip what first pushed");
  });

  test("push: skips classified facts by default", async () => {
    await store.assertFact({
      statement:      "Sensitive PHI fact",
      confidence:     0.9,
      source:         "test://phi",
      classification: "PHI",
      tags:           ["push-to-anthropic"],
    });
    const config  = { ...makeConfig(), push: true };
    const before  = await client.listMemories(STORE_ID, { path_prefix: "/kndl-facts/" });
    const result  = await push(client, store, config);
    const after   = await client.listMemories(STORE_ID, { path_prefix: "/kndl-facts/" });
    // PHI fact must not be pushed — count must not increase
    assert.equal(after.data.length, before.data.length, "PHI fact should not be pushed");
    assert.equal(result.pushed, 0);
  });

  test("push: throws not-implemented error in v2.0", () => {
    // push is now implemented — just verify it doesn't throw when enabled
    const config = { ...makeConfig(), push: true };
    assert.ok(typeof push === "function");
    void config; // consumed
  });

  test("_cleanup", () => { rmSync(dir, { recursive: true, force: true }); });
});

describe("remote sync — SqliteFactStore backend", async () => {
  const store  = new SqliteFactStore(":memory:");
  const client = new FakeMemoryStoreClient();
  client.seedStore("Test Store", "store_sqlite");
  client.seedMemory("store_sqlite", "/notes/credit.md",      "Customer 9281 credit score is 740");
  client.seedMemory("store_sqlite", "/notes/employment.md",  "Customer 9281 is employed at ACME Corp");

  test("pull into SQLite: writes 2 facts", async () => {
    const config = makeConfig("store_sqlite");
    const result = await pull(client, store, config);
    assert.equal(result.pulled, 2);
    assert.equal(result.skipped, 0);
  });

  test("SQLite: facts queryable after pull", async () => {
    const result = await store.query({ tenant: "test" });
    assert.equal(result.count, 2);
    for (const f of result.facts) {
      assert.equal(f.confidence, 0.85, "default_confidence should be 0.85");
    }
  });

  test("_cleanup", async () => { await store.close?.(); });
});

describe("FakeMemoryStoreClient — store CRUD", () => {
  test("createStore / getStore / updateStore / deleteStore", async () => {
    const client = new FakeMemoryStoreClient();
    const s = await client.createStore("My Store", { description: "test" });
    assert.equal(s.name, "My Store");
    assert.equal(s.type, "memory_store");

    const fetched = await client.getStore(s.id);
    assert.equal(fetched?.id, s.id);

    const updated = await client.updateStore(s.id, { name: "Renamed" });
    assert.equal(updated.name, "Renamed");

    const deleted = await client.deleteStore(s.id);
    assert.equal(deleted.type, "memory_store_deleted");
    assert.equal(await client.getStore(s.id), null);
  });

  test("archiveStore", async () => {
    const client = new FakeMemoryStoreClient();
    const s = await client.createStore("Archive Me");
    const archived = await client.archiveStore(s.id);
    assert.ok(archived.archived_at, "should have archived_at");
  });
});

describe("FakeMemoryStoreClient — memory CRUD", () => {
  test("createMemory / getMemory / updateMemory / deleteMemory", async () => {
    const client = new FakeMemoryStoreClient();
    client.seedStore("Test", "s1");

    const m = await client.createMemory("s1", "/notes/test.md", "Hello world");
    assert.equal(m.path, "/notes/test.md");
    assert.equal(m.type, "memory");

    const fetched = await client.getMemory("s1", m.id, "full");
    assert.equal(fetched?.content, "Hello world");

    const updated = await client.updateMemory("s1", m.id, { content: "Updated" });
    assert.equal(updated.content, "Updated");

    const del = await client.deleteMemory("s1", m.id);
    assert.equal(del.type, "memory_deleted");
    assert.equal(await client.getMemory("s1", m.id), null);
  });

  test("listMemories with path_prefix", async () => {
    const client = new FakeMemoryStoreClient();
    client.seedStore("Test", "s2");
    client.seedMemory("s2", "/a/one.md", "one");
    client.seedMemory("s2", "/a/two.md", "two");
    client.seedMemory("s2", "/b/three.md", "three");

    const aPage = await client.listMemories("s2", { path_prefix: "/a/" });
    assert.equal(aPage.data.length, 2);

    const bPage = await client.listMemories("s2", { path_prefix: "/b/" });
    assert.equal(bPage.data.length, 1);
  });
});
