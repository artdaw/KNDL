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
import { pull } from "./remote/sync";
import { loadRemoteConfigs, addRemote, saveRemoteConfigs } from "./remote/config";
import type { FactInput } from "./types";

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
  subject:        z.string().optional(),
  predicate:      z.string().optional(),
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
  label:        z.string().describe("Remote label as registered with `kndl remote add`"),
  direction:    z.enum(["pull"]).default("pull").describe("Only 'pull' supported in v2.0"),
  since:        z.string().optional().describe("ISO datetime — pull only items created after this (if supported by the API)"),
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
  { name: "query_facts",        schema: QuerySchema,         description: "Read active (non-superseded) facts with effective confidence at as_of time. Filter by subject/predicate. Defaults to now." },
  { name: "contradictions",     schema: ContradictionsSchema, description: "Find disagreeing active facts about the same subject/predicate, ranked by recency, confidence, and chain length." },
  { name: "supersede_fact",     schema: SupersedeSchema,     description: "Write a new fact replacing an older one. Preserves history — old fact hidden from queries but available for as_of time-travel." },
  { name: "as_of",              schema: AsOfSchema,          description: "Bitemporal time-travel: what did memory believe at the given timestamp." },
  { name: "provenance_chain",   schema: ProvenanceSchema,    description: "Walk derivedFrom + supersedes backward to surface the full audit trail of a fact." },
  { name: "subscribe",          schema: SubscribeSchema,     description: "Register for notifications when facts matching the filter are written. Returns a subscription id. Re-read kndl://fact/{id} on notifications/resources/updated." },
  { name: "unsubscribe",        schema: UnsubscribeSchema,   description: "Cancel a subscription by id." },
  { name: "list_subscriptions",  schema: z.object({}),             description: "List active subscriptions and session count." },
  { name: "sync_memory_store",   schema: SyncMemoryStoreSchema,    description: "Pull facts from a configured Anthropic Memory Store into the local fact store. Requires ANTHROPIC_API_KEY. Register stores with `kndl remote add`." },
  { name: "list_memory_stores",  schema: z.object({}),             description: "List configured remote Anthropic Memory Stores and their last-sync timestamps." },
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
  try {
    switch (name) {
      case "assert_fact": {
        const a = AssertSchema.parse(args);
        return ok(await store.assertFact(toFactInput(a)));
      }
      case "query_facts": {
        const a = QuerySchema.parse(args);
        return ok(await store.query({
          subject: a.subject, predicate: a.predicate,
          asOf: a.as_of, minConfidence: a.min_confidence,
          tenant: a.tenant, allowPhi: a.allow_phi,
        }));
      }
      case "contradictions": {
        const a = ContradictionsSchema.parse(args);
        return ok(await store.contradictions({ subject: a.subject, predicate: a.predicate }));
      }
      case "supersede_fact": {
        const a = SupersedeSchema.parse(args);
        const { old_id, ...rest } = a;
        return ok(await store.supersedeFact(old_id, toFactInput(rest as z.infer<typeof AssertSchema>)));
      }
      case "as_of": {
        const a = AsOfSchema.parse(args);
        return ok(await store.query({ subject: a.subject, predicate: a.predicate, asOf: a.as_of }));
      }
      case "provenance_chain": {
        const a = ProvenanceSchema.parse(args);
        return ok(await store.provenanceChain(a.id, a.max_depth));
      }
      case "subscribe": {
        const a = SubscribeSchema.parse(args);
        const id = subscriptions.add({ subject: a.subject, predicate: a.predicate, tenant: a.tenant });
        return ok({ subscription_id: id, filter: a, message: `Subscribed. Re-read kndl://fact/<id> on notifications/resources/updated.` });
      }
      case "unsubscribe": {
        const a = UnsubscribeSchema.parse(args);
        const removed = subscriptions.remove(a.id);
        return ok({ removed, id: a.id });
      }
      case "list_subscriptions": {
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
        const result = await pull(client, store, config);
        // Persist updated watermark
        const idx = remotes.findIndex((r) => r.label === a.label);
        if (idx >= 0) remotes[idx] = config;
        saveRemoteConfigs(remotes);
        return ok(result);
      }
      case "list_memory_stores": {
        const remotes = loadRemoteConfigs();
        return ok({ count: remotes.length, remotes: remotes.map((r) => ({
          label: r.label, provider: r.provider, store_id: r.store_id,
          last_synced_at: r.last_synced_at ?? null,
        }))});
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (e) {
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
    if (uri.startsWith("kndl://fact/")) {
      const id = decodeURIComponent(uri.slice("kndl://fact/".length));
      const fact = await store.show(id);
      if (!fact) {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: "not found", id }) }] };
      }
      const result = await store.query({ subject: fact.subject });
      const live = result.facts.find((f) => f["@id"] === id);
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
        onsessioninitialized: (id: string) => { transports.set(id, transport); },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
        activeSessions.delete(sessionServer);
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
