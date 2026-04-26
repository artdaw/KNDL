// tests/remote.test.ts — loopback tests for remote sync using FakeMemoryStoreClient.
// No real API calls; no ANTHROPIC_API_KEY required.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FakeMemoryStoreClient } from "../src/remote/anthropic.js";
import { pull } from "../src/remote/sync.js";
import { FsFactStore } from "../src/stores/fs.js";
import { SqliteFactStore } from "../src/stores/sqlite.js";
import type { RemoteConfig } from "../src/remote/types.js";

function makeConfig(storeId = "store_test"): RemoteConfig {
  return {
    label:              "test",
    provider:           "anthropic",
    store_id:           storeId,
    default_confidence: 0.85,
    push:               false,
  };
}

describe("remote sync — FsFactStore backend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kndl-remote-fs-test-"));
  const store = new FsFactStore(dir);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });

  const client = new FakeMemoryStoreClient();
  client.seed("store_test", [
    { content: "Alice is a senior engineer on the payments team" },
    { content: "The Q1 goal is to reduce p99 latency to under 200ms" },
    { content: "PHI record: patient 9001 has type 2 diabetes", metadata: { classification: "PHI" } },
  ]);

  test("pull: writes all 3 items as facts", async () => {
    const config = makeConfig();
    const result = await pull(client, store, config);
    assert.equal(result.pulled, 3, `expected 3 pulled, got ${result.pulled}`);
    assert.equal(result.skipped, 0);
    assert.equal(result.superseded, 0);
    assert.equal(result.synced_at.endsWith("Z"), true);
  });

  test("pull: facts have correct source URI", async () => {
    const facts = (await store.query()).facts;
    assert.equal(facts.length, 3);
    for (const f of facts) {
      assert.ok(f.source.startsWith("claude-memory://store_test/fake_item_"), `unexpected source: ${f.source}`);
      assert.ok(f.tags?.includes("from-anthropic-memory"), "missing from-anthropic-memory tag");
      assert.ok(f.tags?.some((t) => t.startsWith("content-hash:")), "missing content-hash tag");
    }
  });

  test("pull: idempotent — second pull skips all facts", async () => {
    const config = makeConfig();
    config.last_cursor = undefined; // reset to re-scan all items
    const result = await pull(client, store, config);
    assert.equal(result.pulled,     0, "should skip all already-pulled facts");
    assert.equal(result.skipped,    3, "should report 3 skipped");
    assert.equal(result.superseded, 0);
  });

  test("pull: supersedes when item content changes", async () => {
    // Mutate the fake client item directly to simulate an update
    const items = (await client.listItems("store_test")).items;
    const first = items[0];
    // Re-seed with changed content for first item
    (client as unknown as { stores: Map<string, Map<string, unknown>> })
      .stores.get("store_test")!
      .set(first.id, { ...first, content: "Alice is now a STAFF engineer on the payments team", updated_at: new Date().toISOString() });

    const config = makeConfig();
    const result = await pull(client, store, config);
    assert.equal(result.superseded, 1, "expected 1 superseded fact");
    assert.equal(result.pulled,     0);

    // Active query should show the new statement
    const active = await store.query({ tenant: "test" });
    const aliceFact = active.facts.find((f) => f.statement.includes("STAFF"));
    assert.ok(aliceFact, "superseded fact should appear in active results");
  });

  test("push: throws when config.push is false", async () => {
    const { push } = await import("../src/remote/sync.js");
    // push:false is the default — should throw a clear error
    await assert.rejects(
      () => push(client, store, makeConfig()),
      /Push is disabled/,
    );
  });

  test("push: skips facts without the push_tag", async () => {
    const { push } = await import("../src/remote/sync.js");
    const config = { ...makeConfig(), push: true };
    const result = await push(client, store, config);
    // None of the pulled facts have "push-to-anthropic" tag
    assert.equal(result.pushed, 0);
    assert.equal(result.errors, 0);
  });

  test("push: pushes facts tagged with push_tag", async () => {
    const { push } = await import("../src/remote/sync.js");
    // Assert a fact with the push tag
    await store.assertFact({
      statement: "Test push fact",
      confidence: 0.9,
      source: "test://push",
      tags: ["push-to-anthropic"],
    });
    const config = { ...makeConfig(), push: true };
    const result = await push(client, store, config);
    assert.equal(result.pushed, 1, "expected 1 fact pushed");
    assert.equal(result.errors, 0);
  });

  test("push: idempotent — second push skips already-pushed facts", async () => {
    const { push } = await import("../src/remote/sync.js");
    const config = { ...makeConfig(), push: true };
    const r1 = await push(client, store, config);
    const r2 = await push(client, store, config);
    // Second push should skip what first push created
    assert.ok(r2.pushed === 0, "second push should push nothing new");
    assert.ok(r2.skipped >= r1.pushed, "second push should skip what first pushed");
  });

  test("push: skips classified facts by default", async () => {
    const { push } = await import("../src/remote/sync.js");
    await store.assertFact({
      statement: "Sensitive fact",
      confidence: 0.9,
      source: "test://phi",
      classification: "PHI",
      tags: ["push-to-anthropic"],
    });
    const config = { ...makeConfig(), push: true };
    const result = await push(client, store, config);
    // PHI fact must NOT be pushed
    const pushed = result.pushed;
    // The only newly tagged fact is PHI — it should be skipped
    assert.equal(pushed, 0, "PHI fact should not be pushed");
  });

  // Cleanup after all tests in this suite
  test("_cleanup", () => { cleanup(); });
});

describe("remote sync — SqliteFactStore backend", async () => {
  const store = new SqliteFactStore(":memory:");
  const client = new FakeMemoryStoreClient();
  client.seed("store_sqlite", [
    { content: "Customer 9281 credit score is 740" },
    { content: "Customer 9281 is employed at ACME Corp", metadata: { subject: "customer:9281" } },
  ]);

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
      assert.ok(f.confidence === 0.85, "default_confidence should be 0.85");
    }
  });

  test("_cleanup", async () => { await store.close?.(); });
});

describe("FakeMemoryStoreClient", () => {
  test("seed + listItems pagination", async () => {
    const client = new FakeMemoryStoreClient();
    client.seed("s1", Array.from({ length: 5 }, (_, i) => ({ content: `item ${i}` })));
    const page1 = await client.listItems("s1", { limit: 3 });
    assert.equal(page1.items.length, 3);
    assert.equal(page1.has_more, true);
    assert.ok(page1.next_cursor);
    const page2 = await client.listItems("s1", { after: page1.next_cursor, limit: 3 });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.has_more, false);
  });

  test("getItem returns null for unknown id", async () => {
    const client = new FakeMemoryStoreClient();
    const item = await client.getItem("s1", "nonexistent");
    assert.equal(item, null);
  });
});
