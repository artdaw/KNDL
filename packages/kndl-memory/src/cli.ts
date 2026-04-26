#!/usr/bin/env node
// kndl CLI — invoked from the kndl-memory Skill via bash.
//
// Usage:
//   kndl add --statement "..." --confidence 0.9 --source "..." [--subject ...] [--predicate ...]
//            [--object json] [--decay "0.5/30d"] [--valid-from now|ISO] [--observed-at ISO]
//            [--classification PHI|PII|...] [--consent <id>] [--tenant <id>]
//            [--derived-from id1 id2 ...] [--negated]
//
//   kndl supersede --old-id <id> [add args]
//   kndl query [--subject ...] [--predicate ...] [--as-of now|ISO] [--min-confidence 0.0] [--tenant ...] [--allow-phi]
//   kndl contradictions [--subject ...] [--predicate ...]
//   kndl provenance --id <id> [--max-depth 8]
//   kndl list [--subject ...]
//   kndl show --id <id>
//
// Env:
//   KNDL_STORAGE     Storage URL (default fs:./memory). See stores/index.ts for formats.
//   KNDL_MEMORY_DIR  Legacy alias for fs:<dir> (overridden by KNDL_STORAGE).

import type { FactInput } from "./types.js";
import { makeStore } from "./stores/index.js";
import { AnthropicMemoryClient } from "./remote/anthropic.js";
import { pull, push, syncBoth } from "./remote/sync.js";
import { loadRemoteConfigs, addRemote, removeRemote, saveRemoteConfigs } from "./remote/config.js";

interface Args {
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[key] = true;
      } else {
        const collected: string[] = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
          collected.push(argv[++i]);
        }
        out.flags[key] = collected.length === 1 ? collected[0] : collected;
      }
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function s(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function n(v: unknown): number | undefined {
  if (typeof v === "string") {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : undefined;
  }
  return undefined;
}

function b(v: unknown): boolean {
  return v === true || v === "true";
}

function arr(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return undefined;
}

function requireFlag(v: string | undefined, name: string): string {
  if (v === undefined) fail(`missing required --${name}`);
  return v;
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function buildInput(flags: Record<string, unknown>): FactInput {
  const conf = n(flags.confidence);
  if (conf === undefined) fail("--confidence is required and must be a number");
  let object: unknown = flags.object;
  if (typeof object === "string") {
    try { object = JSON.parse(object); } catch { /* leave as string */ }
  }
  return {
    statement:      requireFlag(s(flags.statement), "statement"),
    confidence:     conf,
    source:         requireFlag(s(flags.source), "source"),
    subject:        s(flags.subject),
    predicate:      s(flags.predicate),
    object,
    decay:          s(flags.decay),
    validFrom:      s(flags["valid-from"]),
    validUntil:     s(flags["valid-until"]),
    observedAt:     s(flags["observed-at"]),
    classification: s(flags.classification),
    consent:        s(flags.consent),
    tenant:         s(flags.tenant),
    derivedFrom:    arr(flags["derived-from"]),
    negated:        b(flags.negated),
  };
}

const HELP = `kndl — confidence-, time-, and provenance-aware memory CLI

Fact commands:
  add              Write a new fact
  supersede        Write a fact replacing an older one (preserves history)
  query            Read active facts with effective confidence at as_of time
  contradictions   Find disagreeing active facts about same subject/predicate
  provenance       Walk derivedFrom + supersedes backward
  list             List fact IDs
  show             Print a fact by ID
  migrate          Migrate v1 SQLite database → v2 JSON-LD facts

Memory Store sync:
  remote           Manage configured remotes (add, pull, push, sync, ls, rm)

Anthropic Memory Stores API (requires ANTHROPIC_API_KEY):
  store            CRUD for Memory Stores (create, ls, get, update, delete, archive)
  memory           CRUD for Memories within a store (create, ls, get, update, delete)

  help             Show this message

Env:
  KNDL_STORAGE          Storage URL, e.g. fs:./memory  sqlite:./kndl.db
  KNDL_MEMORY_DIR       Legacy alias — equivalent to KNDL_STORAGE=fs:<dir>
  ANTHROPIC_API_KEY     Required for store/memory/remote commands
  KNDL_REMOTE_STORES    "anthropic:<store_id>:<label>" shorthand (no file needed)

Run \`kndl store help\` or \`kndl memory help\` for sub-command details.
`;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const { flags } = parseArgs(argv.slice(1));

  if (!cmd || cmd === "help" || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const store = makeStore();

  try {
    switch (cmd) {
      case "add": {
        const r = await store.assertFact(buildInput(flags));
        out({ id: r.id });
        return 0;
      }
      case "supersede": {
        const oldId = requireFlag(s(flags["old-id"]), "old-id");
        const r = await store.supersedeFact(oldId, buildInput(flags));
        out({ id: r.id, supersedes: r.supersedes });
        return 0;
      }
      case "query": {
        out(await store.query({
          subject:       s(flags.subject),
          predicate:     s(flags.predicate),
          asOf:          s(flags["as-of"]),
          minConfidence: n(flags["min-confidence"]),
          tenant:        s(flags.tenant),
          allowPhi:      b(flags["allow-phi"]),
        }));
        return 0;
      }
      case "contradictions": {
        out(await store.contradictions({ subject: s(flags.subject), predicate: s(flags.predicate) }));
        return 0;
      }
      case "provenance": {
        const id = requireFlag(s(flags.id), "id");
        out(await store.provenanceChain(id, n(flags["max-depth"])));
        return 0;
      }
      case "list": {
        out(await store.list(s(flags.subject)));
        return 0;
      }
      case "show": {
        const id = requireFlag(s(flags.id), "id");
        const f = await store.show(id);
        if (!f) { process.stderr.write(`not found: ${id}\n`); return 1; }
        out(f);
        return 0;
      }
      case "migrate": {
        // kndl migrate --from sqlite:./kndl-v1.db --to ./memory
        // Reads a v1 KNDL SQLite database (Python schema) and writes JSON-LD
        // facts for each Node, Edge, and Intent into the target memory directory.
        const from  = requireFlag(s(flags.from), "from");
        const to    = s(flags.to) ?? "./memory";
        const dryRun = b(flags["dry-run"]);
        const { createRequire } = await import("node:module");
        const req = createRequire(import.meta.url);
        const Database = req("better-sqlite3") as typeof import("better-sqlite3");
        const { mkdirSync } = await import("node:fs");
        const { join: pathJoin } = await import("node:path");
        const { writeFileSync, existsSync } = await import("node:fs");
        const { nowIso: _nowIso } = await import("./core.js");

        const dbPath = from.replace(/^sqlite:\/\/\//, "").replace(/^sqlite:\/\//, "");
        const db = new Database(dbPath, { readonly: true });

        let nodes: unknown[], edges: unknown[], intents: unknown[];
        try {
          nodes   = db.prepare("SELECT id, type_name, fields_json, meta_json FROM kndl_nodes").all() as unknown[];
          edges   = db.prepare("SELECT id, source_id, target_id, edge_type, direction, fields_json, meta_json FROM kndl_edges").all() as unknown[];
          intents = db.prepare("SELECT id, type_name, trigger_kind, trigger_data, actions_json, meta_json FROM kndl_intents").all() as unknown[];
        } catch {
          fail(`Could not read v1 schema from ${dbPath}. Is this a KNDL v1 database?`);
        } finally {
          db.close();
        }

        const factsDir = pathJoin(to, "facts");
        if (!dryRun) mkdirSync(factsDir, { recursive: true });

        let written = 0;
        const now = _nowIso();

        function writeFact(fact: Record<string, unknown>): void {
          const id = fact["@id"] as string;
          const fname = id.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 100) + ".fact.json";
          const path = pathJoin(factsDir, fname);
          if (!dryRun) {
            if (existsSync(path)) return; // idempotent
            writeFileSync(path, JSON.stringify(fact, null, 2));
          }
          written++;
        }

        for (const row of nodes!) {
          const r = row as { id: string; type_name: string; fields_json: string; meta_json: string };
          const meta = JSON.parse(r.meta_json || "{}");
          const fields = JSON.parse(r.fields_json || "{}");
          const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
          writeFact({
            "@context": "https://kndl.artdaw.com/context/v1.jsonld",
            "@id":      `fact:v1-node-${r.id}`,
            "@type":    "Fact",
            "statement": `${r.id} (${r.type_name})${fieldStr ? ": " + fieldStr : ""}`,
            "subject":   `node:${r.id}`,
            "predicate": "isa",
            "object":    r.type_name,
            "confidence": meta.confidence ?? 1.0,
            "source":    meta.source || "kndl://v1-migration",
            "validFrom":  meta.valid_start ?? meta.recorded ?? now,
            "recordedAt": meta.recorded ?? now,
            "tags":       ["v1-migration", "node", ...(meta.tags ?? [])],
            ...(meta.decay_rate && meta.decay_duration_seconds
              ? { "decay": `${meta.decay_rate}/${meta.decay_duration_seconds}s` }
              : {}),
          });
        }

        for (const row of edges!) {
          const r = row as { id: string; source_id: string; target_id: string; edge_type: string; direction: string; fields_json: string; meta_json: string };
          const meta = JSON.parse(r.meta_json || "{}");
          writeFact({
            "@context": "https://kndl.artdaw.com/context/v1.jsonld",
            "@id":      `fact:v1-edge-${r.id}`,
            "@type":    "Fact",
            "statement": `${r.source_id} ${r.edge_type} ${r.target_id}`,
            "subject":   `node:${r.source_id}`,
            "predicate": r.edge_type,
            "object":    `node:${r.target_id}`,
            "confidence": meta.confidence ?? 1.0,
            "source":    meta.source || "kndl://v1-migration",
            "validFrom":  now,
            "recordedAt": now,
            "tags":       ["v1-migration", "edge"],
          });
        }

        for (const row of intents!) {
          const r = row as { id: string; type_name: string; trigger_kind: string; trigger_data: string; actions_json: string; meta_json: string };
          const meta = JSON.parse(r.meta_json || "{}");
          writeFact({
            "@context": "https://kndl.artdaw.com/context/v1.jsonld",
            "@id":      `fact:v1-intent-${r.id}`,
            "@type":    "Action",
            "statement": `Intent ${r.id}: when ${r.trigger_data}`,
            "subject":   `intent:${r.id}`,
            "predicate": "trigger",
            "object":    r.trigger_data,
            "confidence": meta.priority ?? 0.5,
            "source":    "kndl://v1-migration",
            "validFrom":  now,
            "recordedAt": now,
            "tags":       ["v1-migration", "intent", r.trigger_kind],
          });
        }

        const summary = {
          from: dbPath, to,
          dry_run: dryRun,
          nodes: (nodes!).length,
          edges: (edges!).length,
          intents: (intents!).length,
          facts_written: written,
        };
        out(summary);
        if (dryRun) process.stderr.write("(dry-run — no files written)\n");
        return 0;
      }

      case "remote": {
        const sub = argv.slice(1);
        const subCmd = sub[0];
        const { flags: rflags } = parseArgs(sub.slice(1));
        switch (subCmd) {
          case "add": {
            const label    = requireFlag(s(rflags.label),    "label");
            const storeId  = requireFlag(s(rflags["store-id"]), "store-id");
            const provider = (s(rflags.provider) ?? "anthropic") as "anthropic";
            const enablePush = b(rflags.push);
            const pushTag    = s(rflags["push-tag"]);
            addRemote({
              label, provider, store_id: storeId,
              default_confidence: Number(rflags["default-confidence"] ?? 0.85),
              push: enablePush,
              ...(pushTag ? { push_tag: pushTag } : {}),
            });
            out({ added: label, store_id: storeId, provider, push: enablePush, push_tag: pushTag ?? "push-to-anthropic" });
            return 0;
          }
          case "pull": {
            const label = requireFlag(s(rflags._) ?? s(sub[1]), "label");
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) fail("ANTHROPIC_API_KEY is not set");
            const remotes = loadRemoteConfigs();
            const config = remotes.find((r) => r.label === label);
            if (!config) fail(`Remote '${label}' not found. Run \`kndl remote add\` first.`);
            const client = new AnthropicMemoryClient(apiKey);
            const store = makeStore();
            const result = await pull(client, store, config!);
            const idx = remotes.findIndex((r) => r.label === label);
            if (idx >= 0) remotes[idx] = config!;
            saveRemoteConfigs(remotes);
            out(result);
            return 0;
          }
          case "push": {
            const label = requireFlag(s(rflags._) ?? s(sub[1]), "label");
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) fail("ANTHROPIC_API_KEY is not set");
            const remotes = loadRemoteConfigs();
            const config = remotes.find((r) => r.label === label);
            if (!config) fail(`Remote '${label}' not found. Run \`kndl remote add\` first.`);
            const client = new AnthropicMemoryClient(apiKey);
            const store = makeStore();
            const result = await push(client, store, config!);
            const idx = remotes.findIndex((r) => r.label === label);
            if (idx >= 0) remotes[idx] = config!;
            saveRemoteConfigs(remotes);
            out(result);
            return 0;
          }
          case "sync": {
            const label = requireFlag(s(rflags._) ?? s(sub[1]), "label");
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) fail("ANTHROPIC_API_KEY is not set");
            const remotes = loadRemoteConfigs();
            const config = remotes.find((r) => r.label === label);
            if (!config) fail(`Remote '${label}' not found. Run \`kndl remote add\` first.`);
            const client = new AnthropicMemoryClient(apiKey);
            const store = makeStore();
            const result = await syncBoth(client, store, config!);
            const idx = remotes.findIndex((r) => r.label === label);
            if (idx >= 0) remotes[idx] = config!;
            saveRemoteConfigs(remotes);
            out(result);
            return 0;
          }
          case "ls":
          case "list": {
            out(loadRemoteConfigs().map((r) => ({
              label: r.label, provider: r.provider, store_id: r.store_id,
              push: r.push, push_tag: r.push_tag ?? "push-to-anthropic",
              last_synced_at: r.last_synced_at ?? null,
            })));
            return 0;
          }
          case "rm":
          case "remove": {
            const label = requireFlag(s(rflags._) ?? s(sub[1]), "label");
            const removed = removeRemote(label);
            out({ removed, label });
            return 0;
          }
          default:
            fail(`unknown remote sub-command: ${subCmd ?? "(none)"}. Try: add, pull, push, sync, ls, rm`);
        }
      }
      // ── store — Memory Store CRUD ────────────────────────────────────────────
      case "store": {
        const sub    = argv.slice(1);
        const subCmd = sub[0];
        const { flags: sf } = parseArgs(sub.slice(1));
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) fail("ANTHROPIC_API_KEY is not set");
        const api = new AnthropicMemoryClient(apiKey);

        const STORE_HELP = `kndl store — Anthropic Memory Store CRUD

Sub-commands:
  create  --name <name> [--description <desc>]   Create a new Memory Store
  ls      [--archived]                            List all stores
  get     <store_id>                              Get store details
  update  <store_id> [--name <n>] [--description <d>]  Update store
  delete  <store_id>                              Permanently delete a store
  archive <store_id>                              Archive a store (soft delete)
`;
        if (!subCmd || subCmd === "help" || sf.help) {
          process.stdout.write(STORE_HELP);
          return 0;
        }

        switch (subCmd) {
          case "create": {
            const name = requireFlag(s(sf.name), "name");
            out(await api.createStore(name, { description: s(sf.description) }));
            return 0;
          }
          case "ls":
          case "list": {
            out(await api.listStores({ include_archived: b(sf.archived) }));
            return 0;
          }
          case "get": {
            const id = requireFlag(s(sf._) ?? s(sub[1]), "store_id");
            const store = await api.getStore(id);
            if (!store) fail(`Store '${id}' not found`);
            out(store!);
            return 0;
          }
          case "update": {
            const id = requireFlag(s(sf._) ?? s(sub[1]), "store_id");
            out(await api.updateStore(id, { name: s(sf.name), description: s(sf.description) }));
            return 0;
          }
          case "delete": {
            const id = requireFlag(s(sf._) ?? s(sub[1]), "store_id");
            out(await api.deleteStore(id));
            return 0;
          }
          case "archive": {
            const id = requireFlag(s(sf._) ?? s(sub[1]), "store_id");
            out(await api.archiveStore(id));
            return 0;
          }
          default:
            fail(`unknown store sub-command: ${subCmd}. Try: create, ls, get, update, delete, archive`);
        }
        return 0;
      }

      // ── memory — Memory CRUD ─────────────────────────────────────────────────
      case "memory": {
        const sub    = argv.slice(1);
        const subCmd = sub[0];
        const { flags: mf } = parseArgs(sub.slice(1));
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) fail("ANTHROPIC_API_KEY is not set");
        const api = new AnthropicMemoryClient(apiKey);

        const MEMORY_HELP = `kndl memory — Memory CRUD within an Anthropic Memory Store

Sub-commands:
  create  --store <id> --path <path> --content <text>   Create a memory
  ls      --store <id> [--prefix <path>]                List memories
  get     --store <id> <memory_id>                      Get memory (full content)
  update  --store <id> <memory_id> [--content <t>] [--path <p>]  Update
  delete  --store <id> <memory_id>                      Delete a memory

Path convention: filesystem-style, e.g. /notes/alice.md, /kndl-facts/fact-...
`;
        if (!subCmd || subCmd === "help" || mf.help) {
          process.stdout.write(MEMORY_HELP);
          return 0;
        }

        const storeId = requireFlag(s(mf.store), "store");

        switch (subCmd) {
          case "create": {
            const path    = requireFlag(s(mf.path),    "path");
            const content = requireFlag(s(mf.content), "content");
            out(await api.createMemory(storeId, path, content));
            return 0;
          }
          case "ls":
          case "list": {
            out(await api.listMemories(storeId, {
              path_prefix: s(mf.prefix),
              limit:       n(mf.limit),
              view:        "basic",
            }));
            return 0;
          }
          case "get": {
            const memId = requireFlag(s(mf._) ?? s(sub[1]), "memory_id");
            const mem = await api.getMemory(storeId, memId, "full");
            if (!mem) fail(`Memory '${memId}' not found in store '${storeId}'`);
            out(mem!);
            return 0;
          }
          case "update": {
            const memId = requireFlag(s(mf._) ?? s(sub[1]), "memory_id");
            out(await api.updateMemory(storeId, memId, {
              content: s(mf.content),
              path:    s(mf.path),
            }));
            return 0;
          }
          case "delete": {
            const memId = requireFlag(s(mf._) ?? s(sub[1]), "memory_id");
            out(await api.deleteMemory(storeId, memId));
            return 0;
          }
          default:
            fail(`unknown memory sub-command: ${subCmd}. Try: create, ls, get, update, delete`);
        }
        return 0;
      }

      default:
        fail(`unknown command: ${cmd}. Run \`kndl help\` for usage.`);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

main(process.argv.slice(2)).then(process.exit).catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
