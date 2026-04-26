#!/usr/bin/env node
// kndl-memory-mcp — MCP server for KNDL JSON-LD facts.
//
// Tools:
//   assert_fact         — write a new fact
//   query_facts         — read active facts with effective confidence at as_of
//   contradictions      — find disagreeing active facts
//   supersede_fact      — write a fact replacing an older one (preserves history)
//   as_of               — bitemporal time-travel query
//   provenance_chain    — walk derivedFrom + supersedes backward
//   subscribe           — register for notifications when matching facts change
//   unsubscribe         — cancel a subscription
//   list_subscriptions  — inspect active subscriptions
//   sync_memory_store   — pull from an Anthropic Memory Store (gated on ANTHROPIC_API_KEY)
//   list_memory_stores  — list configured remote stores and last-sync timestamps
//   watch_memory_store  — NOT AVAILABLE in v2.0 (pending watermark API verification)
//
// Resources:
//   kndl://fact/{id}  — live snapshot; clients re-read on notifications/resources/updated
//
// Transport:
//   stdio (default)   — for Claude Desktop, Goose (stdio), Anthropic Memory
//   --http            — StreamableHTTPServerTransport, port $PORT (default 8000), /mcp
//
// Env:
//   KNDL_STORAGE      — store URL (default fs:./memory). See stores/index.ts.
//   KNDL_MEMORY_DIR   — legacy alias for fs:<dir>
//   PORT              — HTTP port (default 8000, --http only)

import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { makeStore } from "./stores/index";
import { NotifyingStore, SubscriptionRegistry, attachFsWatcher } from "./notify";
import { AnthropicMemoryClient } from "./remote/anthropic";
import { pull, push, syncBoth } from "./remote/sync";
import { loadRemoteConfigs, addRemote, saveRemoteConfigs } from "./remote/config";
import type { FactInput } from "./types";

// ── Logger ────────────────────────────────────────────────────────────────────

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "WARNING").toUpperCase();
const IS_DEBUG  = LOG_LEVEL === "DEBUG";

function debug(...parts: unknown[]): void {
  if (!IS_DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  process.stderr.write(`[kndl-memory] DEBUG ${ts} ${parts.map(p =>
    typeof p === "object" ? JSON.stringify(p) : String(p)
  ).join(" ")}\n`);
}

// ── Store setup ──────────────────────────────────────────────────────────────

const innerStore = makeStore();
const store = new NotifyingStore(innerStore);
const subscriptions = new SubscriptionRegistry();

// Attach cross-process FS watcher if the underlying store is FsFactStore
import("./stores/fs").then(({ FsFactStore }) => {
  if (innerStore instanceof FsFactStore) {
    attachFsWatcher(innerStore.factsDir, (ev) => {
      store.emitter.emit("change", ev);
    }).catch(() => {});
  }
}).catch(() => {});

// ── Broadcast on writes ───────────────────────────────────────────────────────
// When a fact changes, send notifications/resources/updated to every
// active session that has a matching subscription.

const activeSessions = new Set<Server>();

store.emitter.on("change", async (ev: { factId: string; type: string }) => {
  const fact = await store.show(ev.factId).catch(() => null);
  const matching = fact
    ? subscriptions.matches({
        subject:   fact.subject,
        predicate: fact.predicate,
        tenant:    fact.tenant,
      })
    : subscriptions.list(); // broadcast to all if fact not found

  if (matching.length === 0) return;

  const uri = `kndl://fact/${ev.factId}`;
  for (const session of activeSessions) {
    try {
      await (session as unknown as {
        sendResourceUpdated(p: { uri: string }): Promise<void>;
      }).sendResourceUpdated({ uri });
    } catch {
      // session may have closed — ignore
    }
  }
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AssertSchema = z.object({
  statement:      z.string().describe("Plain-language assertion"),
  confidence:     z.number().min(0).max(1).describe("Epistemic certainty 0–1"),
  source:         z.string().describe("URI of asserting entity; use human://<name> for user input"),
  subject:        z.string().optional().describe("Entity URI (structured triple form)"),
  predicate:      z.string().optional().describe("Property name (structured triple form)"),
  object:         z.unknown().optional().describe("Value or object URI (structured triple form)"),
  decay:          z.string().optional().describe("Decay spec e.g. '0.5/30d' (halves every 30 days)"),
  valid_from:     z.string().optional().describe("ISO datetime when fact became true in the world"),
  valid_until:    z.string().optional().describe("ISO datetime when fact expires"),
  observed_at:    z.string().optional().describe("ISO datetime when directly observed"),
  classification: z.string().optional().describe("PII | PHI | PCI | INTERNAL | ..."),
  consent:        z.string().optional().describe("@id of consent scope (required if PHI)"),
  tenant:         z.string().optional().describe("Opaque tenant identifier"),
  derived_from:   z.array(z.string()).optional().describe("@ids of source facts"),
  negated:        z.boolean().optional().describe("True = this assertion is known-false"),
});

const QuerySchema = z.object({
  subject:        z.string().optional().describe("Exact subject URI, e.g. 'person:alice', 'customer:9281'. Must match exactly what was stored."),
  predicate:      z.string().optional(),
  text:           z.string().optional().describe("Case-insensitive substring search across statement + subject. Use this when you don't know the exact subject URI — e.g. 'alice' finds facts with subject 'person:alice' or statement containing 'Alice'."),
  as_of:          z.string().optional().describe("ISO datetime or 'now'"),
  min_confidence: z.number().min(0).max(1).optional(),
  tenant:         z.string().optional(),
  allow_phi:      z.boolean().optional(),
});

const ContradictionsSchema = z.object({
  subject:   z.string().optional(),
  predicate: z.string().optional(),
});

const SupersedeSchema = AssertSchema.extend({ old_id: z.string() });

const AsOfSchema = z.object({
  as_of:     z.string().describe("ISO datetime — what did memory believe at this time"),
  subject:   z.string().optional(),
  predicate: z.string().optional(),
});

const ProvenanceSchema = z.object({
  id:        z.string().describe("@id of the fact to trace"),
  max_depth: z.number().int().positive().optional(),
});

const SubscribeSchema = z.object({
  subject:   z.string().optional().describe("Only notify for this subject"),
  predicate: z.string().optional().describe("Only notify for this predicate"),
  tenant:    z.string().optional().describe("Only notify for this tenant"),
});

const UnsubscribeSchema = z.object({
  id: z.string().describe("Subscription id returned by subscribe"),
});

const SyncMemoryStoreSchema = z.object({
  label:     z.string().describe("Remote label as registered with `kndl remote add`"),
  direction: z.enum(["pull", "push", "both"]).default("pull").describe(
    "'pull' — Anthropic → local (default). " +
    "'push' — local → Anthropic (tagged facts, no classified data). " +
    "'both' — pull then push."
  ),
});

// Store admin schemas (direct Anthropic API, bypasses local config)
const CreateStoreSchema = z.object({
  name:        z.string().describe("Human-readable name for the Memory Store"),
  description: z.string().optional(),
});

const StoreIdSchema = z.object({
  store_id: z.string().describe("Anthropic Memory Store ID (e.g. store_abc123)"),
});

const UpdateStoreSchema = StoreIdSchema.extend({
  name:        z.string().optional(),
  description: z.string().optional(),
});

const ListMemoriesSchema = StoreIdSchema.extend({
  path_prefix: z.string().optional().describe("Filter memories by path prefix, e.g. '/kndl-facts/'"),
  limit:       z.number().int().positive().optional(),
});

const CreateMemorySchema = StoreIdSchema.extend({
  path:    z.string().describe("Filesystem-style path, e.g. '/notes/alice.md'"),
  content: z.string().describe("Text content of the memory"),
});

const MemoryIdSchema = StoreIdSchema.extend({
  memory_id: z.string().describe("Memory ID"),
});

const UpdateMemorySchema = MemoryIdSchema.extend({
  content: z.string().optional(),
  path:    z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toFactInput(args: z.infer<typeof AssertSchema>): FactInput {
  return {
    statement:      args.statement,
    confidence:     args.confidence,
    source:         args.source,
    subject:        args.subject,
    predicate:      args.predicate,
    object:         args.object,
    decay:          args.decay,
    validFrom:      args.valid_from,
    validUntil:     args.valid_until,
    observedAt:     args.observed_at,
    classification: args.classification,
    consent:        args.consent,
    tenant:         args.tenant,
    derivedFrom:    args.derived_from,
    negated:        args.negated,
  };
}

function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string; [k: string]: unknown } })._def;
  if (def.typeName === "ZodObject") {
    const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJson(v);
      if (!(v as unknown as { isOptional(): boolean }).isOptional()) required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (def.typeName === "ZodOptional") return zodToJson(def.innerType as z.ZodTypeAny);
  if (def.typeName === "ZodString")  return { type: "string" };
  if (def.typeName === "ZodNumber")  return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodArray")   return { type: "array", items: zodToJson(def.type as z.ZodTypeAny) };
  if (def.typeName === "ZodUnknown") return {};
  return {};
}

function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function err(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `error: ${(e as Error).message}` }] };
}

// ── Server factory ────────────────────────────────────────────────────────────
// The MCP SDK requires one Server instance per transport connection.
// makeServer() creates a fresh instance with all handlers wired up.
// Stdio mode calls it once; HTTP mode calls it for every new session.

function makeServer(): Server {
  const srv = new Server(
    { name: "kndl-memory", version: "2.0.0-alpha.3" },
    { capabilities: { tools: {}, resources: {} } },
  );

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS = [
  { name: "assert_fact",        schema: AssertSchema,        description: "Write a new immutable fact. Include source, confidence, validFrom. Add decay for time-sensitive data ('0.5/30d' halves every 30 days)." },
  { name: "query_facts",        schema: QuerySchema,         description: "Read active facts with effective confidence at as_of time. Use 'subject' for exact URI match (e.g. 'person:alice') or 'text' for substring search when you don't know the exact subject." },
  { name: "contradictions",     schema: ContradictionsSchema, description: "Find disagreeing active facts about the same subject/predicate, ranked by recency, confidence, and chain length." },
  { name: "supersede_fact",     schema: SupersedeSchema,     description: "Write a new fact replacing an older one. Preserves history — old fact hidden from queries but available for as_of time-travel." },
  { name: "as_of",              schema: AsOfSchema,          description: "Bitemporal time-travel: what did memory believe at the given timestamp." },
  { name: "provenance_chain",   schema: ProvenanceSchema,    description: "Walk derivedFrom + supersedes backward to surface the full audit trail of a fact." },
  { name: "subscribe",          schema: SubscribeSchema,     description: "Register for notifications when facts matching the filter are written. Returns a subscription id. Re-read kndl://fact/{id} on notifications/resources/updated." },
  { name: "unsubscribe",        schema: UnsubscribeSchema,   description: "Cancel a subscription by id." },
  { name: "list_subscriptions",  schema: z.object({}),             description: "List active subscriptions and session count." },
  { name: "sync_memory_store",   schema: SyncMemoryStoreSchema,    description: "Sync with a configured Anthropic Memory Store (registered via kndl remote add). direction=pull|push|both. Requires ANTHROPIC_API_KEY." },
  { name: "list_memory_stores",  schema: z.object({}),             description: "List configured remote Memory Stores and their last-sync timestamps." },
  // Direct Memory Store API
  { name: "create_memory_store", schema: CreateStoreSchema,        description: "Create a new Anthropic Memory Store via the API. Returns store_id needed for other operations." },
  { name: "list_all_stores",     schema: z.object({}),             description: "List all Anthropic Memory Stores in your account." },
  { name: "get_memory_store",    schema: StoreIdSchema,            description: "Get details of an Anthropic Memory Store by ID." },
  { name: "update_memory_store", schema: UpdateStoreSchema,        description: "Update the name or description of a Memory Store." },
  { name: "delete_memory_store", schema: StoreIdSchema,            description: "Permanently delete a Memory Store and all its memories." },
  { name: "archive_memory_store",schema: StoreIdSchema,            description: "Archive a Memory Store (soft delete; recoverable)." },
  { name: "list_memories",       schema: ListMemoriesSchema,       description: "List memories in a Memory Store. Use path_prefix to filter (e.g. '/kndl-facts/')." },
  { name: "get_memory",          schema: MemoryIdSchema,           description: "Get a specific memory by ID (returns full content)." },
  { name: "create_memory",       schema: CreateMemorySchema,       description: "Create a memory in a Memory Store at the given path." },
  { name: "update_memory",       schema: UpdateMemorySchema,       description: "Update the content or path of an existing memory." },
  { name: "delete_memory",       schema: MemoryIdSchema,           description: "Delete a memory from a Memory Store." },
] as const;

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJson(t.schema),
    })),
  }));

  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const t0 = Date.now();
  debug(`→ tool:${name}`, args ?? {});
  try {
    switch (name) {
      case "assert_fact": {
        const a = AssertSchema.parse(args);
        const r = ok(await store.assertFact(toFactInput(a)));
        debug(`← tool:${name} ${Date.now() - t0}ms id=${JSON.parse(r.content[0].text).id}`);
        return r;
      }
      case "query_facts": {
        const a = QuerySchema.parse(args);
        const r = ok(await store.query({ subject: a.subject, predicate: a.predicate, text: a.text, asOf: a.as_of, minConfidence: a.min_confidence, tenant: a.tenant, allowPhi: a.allow_phi }));
        debug(`← tool:${name} ${Date.now() - t0}ms count=${JSON.parse(r.content[0].text).count}`);
        return r;
      }
      case "contradictions": {
        const a = ContradictionsSchema.parse(args);
        const r = ok(await store.contradictions({ subject: a.subject, predicate: a.predicate }));
        debug(`← tool:${name} ${Date.now() - t0}ms count=${JSON.parse(r.content[0].text).count}`);
        return r;
      }
      case "supersede_fact": {
        const a = SupersedeSchema.parse(args);
        const { old_id, ...rest } = a;
        const r = ok(await store.supersedeFact(old_id, toFactInput(rest as z.infer<typeof AssertSchema>)));
        debug(`← tool:${name} ${Date.now() - t0}ms id=${JSON.parse(r.content[0].text).id}`);
        return r;
      }
      case "as_of": {
        const a = AsOfSchema.parse(args);
        const r = ok(await store.query({ subject: a.subject, predicate: a.predicate, asOf: a.as_of }));
        debug(`← tool:${name} ${Date.now() - t0}ms count=${JSON.parse(r.content[0].text).count}`);
        return r;
      }
      case "provenance_chain": {
        const a = ProvenanceSchema.parse(args);
        const r = ok(await store.provenanceChain(a.id, a.max_depth));
        debug(`← tool:${name} ${Date.now() - t0}ms depth=${JSON.parse(r.content[0].text).depth}`);
        return r;
      }
      case "subscribe": {
        const a = SubscribeSchema.parse(args);
        const id = subscriptions.add({ subject: a.subject, predicate: a.predicate, tenant: a.tenant });
        debug(`← tool:${name} ${Date.now() - t0}ms subscription_id=${id}`);
        return ok({ subscription_id: id, filter: a, message: `Subscribed. Re-read kndl://fact/<id> on notifications/resources/updated.` });
      }
      case "unsubscribe": {
        const a = UnsubscribeSchema.parse(args);
        const removed = subscriptions.remove(a.id);
        debug(`← tool:${name} ${Date.now() - t0}ms removed=${removed}`);
        return ok({ removed, id: a.id });
      }
      case "list_subscriptions": {
        debug(`← tool:${name} ${Date.now() - t0}ms count=${subscriptions.size}`);
        return ok({ count: subscriptions.size, subscriptions: subscriptions.list(), active_sessions: activeSessions.size });
      }
      case "sync_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Set it to use remote sync.");
        const a = SyncMemoryStoreSchema.parse(args);
        const remotes = loadRemoteConfigs();
        const config = remotes.find((r) => r.label === a.label);
        if (!config) throw new Error(`Remote '${a.label}' not found. Run \`kndl remote add\` first.`);
        const client = new AnthropicMemoryClient(apiKey);
        let result: unknown;
        if (a.direction === "pull") {
          result = await pull(client, store, config);
          debug(`← tool:${name} ${Date.now() - t0}ms pull pulled=${(result as { pulled: number }).pulled}`);
        } else if (a.direction === "push") {
          result = await push(client, store, config);
          debug(`← tool:${name} ${Date.now() - t0}ms push pushed=${(result as { pushed: number }).pushed}`);
        } else {
          result = await syncBoth(client, store, config);
          debug(`← tool:${name} ${Date.now() - t0}ms both`);
        }
        const idx = remotes.findIndex((r) => r.label === a.label);
        if (idx >= 0) remotes[idx] = config;
        saveRemoteConfigs(remotes);
        return ok(result);
      }
      case "list_memory_stores": {
        const remotes = loadRemoteConfigs();
        debug(`← tool:${name} ${Date.now() - t0}ms count=${remotes.length}`);
        return ok({ count: remotes.length, remotes: remotes.map((r) => ({
          label: r.label, provider: r.provider, store_id: r.store_id,
          push: r.push, last_synced_at: r.last_synced_at ?? null,
        }))});
      }

      // ── Direct Memory Store API ────────────────────────────────────────────
      case "create_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = CreateStoreSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.createStore(a.name, { description: a.description }));
        debug(`← tool:${name} ${Date.now() - t0}ms id=${JSON.parse(r.content[0].text).id}`);
        return r;
      }
      case "list_all_stores": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.listStores());
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "get_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = StoreIdSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const store = await client.getStore(a.store_id);
        if (!store) throw new Error(`Memory Store '${a.store_id}' not found.`);
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return ok(store);
      }
      case "update_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = UpdateStoreSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.updateStore(a.store_id, { name: a.name, description: a.description }));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "delete_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = StoreIdSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.deleteStore(a.store_id));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "archive_memory_store": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = StoreIdSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.archiveStore(a.store_id));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "list_memories": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = ListMemoriesSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.listMemories(a.store_id, { path_prefix: a.path_prefix, limit: a.limit, view: "basic" }));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "get_memory": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = MemoryIdSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const memory = await client.getMemory(a.store_id, a.memory_id, "full");
        if (!memory) throw new Error(`Memory '${a.memory_id}' not found in store '${a.store_id}'.`);
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return ok(memory);
      }
      case "create_memory": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = CreateMemorySchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.createMemory(a.store_id, a.path, a.content));
        debug(`← tool:${name} ${Date.now() - t0}ms id=${JSON.parse(r.content[0].text).id}`);
        return r;
      }
      case "update_memory": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = UpdateMemorySchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.updateMemory(a.store_id, a.memory_id, { content: a.content, path: a.path }));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }
      case "delete_memory": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
        const a = MemoryIdSchema.parse(args);
        const client = new AnthropicMemoryClient(apiKey);
        const r = ok(await client.deleteMemory(a.store_id, a.memory_id));
        debug(`← tool:${name} ${Date.now() - t0}ms`);
        return r;
      }

      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (e) {
    debug(`← tool:${name} ERROR ${Date.now() - t0}ms`, (e as Error).message);
    return err(e);
  }
  });

// ── Resources ─────────────────────────────────────────────────────────────────

  srv.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "kndl://fact/{id}",
      name: "Live fact snapshot",
      description: "Current state of a fact — fields + effective_confidence. Re-read on notifications/resources/updated.",
      mimeType: "application/json",
    },
  ],
}));

  srv.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const t0 = Date.now();
    debug(`→ resource:read ${uri}`);
    if (uri.startsWith("kndl://fact/")) {
      const id = decodeURIComponent(uri.slice("kndl://fact/".length));
      const fact = await store.show(id);
      if (!fact) {
        debug(`← resource:read ${Date.now() - t0}ms NOT_FOUND ${uri}`);
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: "not found", id }) }] };
      }
      const result = await store.query({ subject: fact.subject });
      const live = result.facts.find((f) => f["@id"] === id);
      debug(`← resource:read ${Date.now() - t0}ms OK ${uri}`);
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(live ?? fact, null, 2),
        }],
      };
    }
    throw new Error(`unknown resource: ${uri}`);
  });

  return srv;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const isHttp = process.argv.includes("--http");
const PORT   = parseInt(process.env.PORT ?? "8000", 10);

if (isHttp) {
  const express = (await import("express")).default;
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  app.all("/mcp", async (req: import("express").Request, res: import("express").Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST" && !sessionId) {
      // Fresh Server instance per connection — the SDK does not allow a single
      // Server to connect to more than one transport simultaneously.
      const sessionServer = makeServer();
      let transport!: InstanceType<typeof StreamableHTTPServerTransport>;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          transports.set(id, transport);
          debug(`session:open id=${id} sessions=${transports.size}`);
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) transports.delete(id);
        activeSessions.delete(sessionServer);
        debug(`session:close id=${id ?? "?"} sessions=${transports.size}`);
      };
      await sessionServer.connect(transport);
      activeSessions.add(sessionServer);
      await transport.handleRequest(req, res, req.body);
    } else if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ error: "bad session" });
    }
  });

  app.listen(PORT, () => {
    process.stderr.write(`[kndl-memory] HTTP MCP server on http://localhost:${PORT}/mcp\n`);
  });
} else {
  const stdioServer = makeServer();
  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);
  activeSessions.add(stdioServer);
  process.stderr.write(`[kndl-memory] stdio MCP server ready\n`);
}
