#!/usr/bin/env node
// kndl-memory-mcp — Model Context Protocol server for KNDL JSON-LD facts.
//
// Tools exposed:
//   assert_fact         — write a new fact
//   query_facts         — read active facts with effective confidence at as_of
//   contradictions      — find disagreeing active facts
//   supersede_fact      — write a new fact that replaces an old one
//   as_of               — bitemporal time-travel query
//   provenance_chain    — walk derivedFrom + supersedes backward
//
// Storage: $KNDL_MEMORY_DIR/facts/*.fact.json (default ./memory).
// Designed to mount into Anthropic Memory on Managed Agents.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { makeStore } from "./stores/index.js";

const store = makeStore();

// ───────── zod schemas ─────────

const AssertSchema = z.object({
  statement: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  object: z.unknown().optional(),
  decay: z.string().optional(),
  valid_from: z.string().optional(),
  valid_until: z.string().optional(),
  observed_at: z.string().optional(),
  classification: z.string().optional(),
  consent: z.string().optional(),
  tenant: z.string().optional(),
  derived_from: z.array(z.string()).optional(),
  negated: z.boolean().optional(),
});

const QuerySchema = z.object({
  subject: z.string().optional(),
  predicate: z.string().optional(),
  as_of: z.string().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  tenant: z.string().optional(),
  allow_phi: z.boolean().optional(),
});

const ContradictionsSchema = z.object({
  subject: z.string().optional(),
  predicate: z.string().optional(),
});

const SupersedeSchema = AssertSchema.extend({ old_id: z.string() });

const AsOfSchema = z.object({
  as_of: z.string(),
  subject: z.string().optional(),
  predicate: z.string().optional(),
});

const ProvenanceSchema = z.object({
  id: z.string(),
  max_depth: z.number().int().positive().optional(),
});

// ───────── helpers ─────────

function toFactInput(args: z.infer<typeof AssertSchema>) {
  return {
    statement: args.statement,
    confidence: args.confidence,
    source: args.source,
    subject: args.subject,
    predicate: args.predicate,
    object: args.object,
    decay: args.decay,
    validFrom: args.valid_from,
    validUntil: args.valid_until,
    observedAt: args.observed_at,
    classification: args.classification,
    consent: args.consent,
    tenant: args.tenant,
    derivedFrom: args.derived_from,
    negated: args.negated,
  };
}

// minimal Zod -> JSON Schema. Replace with `zod-to-json-schema` for prod.
function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string; [k: string]: unknown } })._def;
  if (def.typeName === "ZodObject") {
    const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJson(v);
      if (!(v as unknown as { isOptional: () => boolean }).isOptional()) required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (def.typeName === "ZodOptional") return zodToJson(def.innerType as z.ZodTypeAny);
  if (def.typeName === "ZodString") return { type: "string" };
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodArray") return { type: "array", items: zodToJson(def.type as z.ZodTypeAny) };
  return {};
}

// ───────── server wiring ─────────

const server = new Server(
  { name: "kndl-memory", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "assert_fact",
    description: "Write a new fact to memory. Always include source, confidence, validFrom. Add decay for time-sensitive data (e.g. '0.5/30d' halves confidence every 30 days).",
    inputSchema: AssertSchema,
  },
  {
    name: "query_facts",
    description: "Read active (non-superseded) facts with effective confidence applied at as_of time. Filter by subject/predicate. Defaults to now.",
    inputSchema: QuerySchema,
  },
  {
    name: "contradictions",
    description: "Find disagreeing active facts about the same subject/predicate. Returns preferred fact and conflicts ranked by recency, confidence, and chain length.",
    inputSchema: ContradictionsSchema,
  },
  {
    name: "supersede_fact",
    description: "Write a new fact that replaces an older one. Preserves history (the old fact is hidden from queries but available for as_of time-travel).",
    inputSchema: SupersedeSchema,
  },
  {
    name: "as_of",
    description: "Bitemporal time-travel: what did memory believe at the given timestamp.",
    inputSchema: AsOfSchema,
  },
  {
    name: "provenance_chain",
    description: "Walk derivedFrom + supersedes backward to surface the audit trail of a fact.",
    inputSchema: ProvenanceSchema,
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJson(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case "assert_fact": {
        const a = AssertSchema.parse(args);
        result = store.assertFact(toFactInput(a));
        break;
      }
      case "query_facts": {
        const a = QuerySchema.parse(args);
        result = store.query({
          subject: a.subject,
          predicate: a.predicate,
          asOf: a.as_of,
          minConfidence: a.min_confidence,
          tenant: a.tenant,
          allowPhi: a.allow_phi,
        });
        break;
      }
      case "contradictions": {
        const a = ContradictionsSchema.parse(args);
        result = store.contradictions({ subject: a.subject, predicate: a.predicate });
        break;
      }
      case "supersede_fact": {
        const a = SupersedeSchema.parse(args);
        const { old_id, ...rest } = a;
        result = store.supersedeFact(old_id, toFactInput(rest as z.infer<typeof AssertSchema>));
        break;
      }
      case "as_of": {
        const a = AsOfSchema.parse(args);
        result = store.query({ subject: a.subject, predicate: a.predicate, asOf: a.as_of });
        break;
      }
      case "provenance_chain": {
        const a = ProvenanceSchema.parse(args);
        result = store.provenanceChain(a.id, a.max_depth);
        break;
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${(e as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("kndl-memory MCP server ready\n");
