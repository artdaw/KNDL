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
import { pull } from "./remote/sync.js";
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

Commands:
  add              Write a new fact
  supersede        Write a fact replacing an older one (preserves history)
  query            Read active facts with effective confidence at as_of time
  contradictions   Find disagreeing active facts about same subject/predicate
  provenance       Walk derivedFrom + supersedes backward
  list             List fact IDs
  show             Print a fact by ID
  remote           Manage and sync Anthropic Memory Store remotes
  help             Show this message

Env:
  KNDL_STORAGE          Storage URL, e.g. fs:./memory  sqlite:./kndl.db
  KNDL_MEMORY_DIR       Legacy alias — equivalent to KNDL_STORAGE=fs:<dir>
  ANTHROPIC_API_KEY     Required for remote sync commands
  KNDL_REMOTE_STORES    "anthropic:<store_id>:<label>" shorthand (no file needed)

Run \`kndl <command> --help\` for options, or read SKILL.md.
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
      case "remote": {
        const sub = argv.slice(1);
        const subCmd = sub[0];
        const { flags: rflags } = parseArgs(sub.slice(1));
        switch (subCmd) {
          case "add": {
            const label    = requireFlag(s(rflags.label),    "label");
            const storeId  = requireFlag(s(rflags["store-id"]), "store-id");
            const provider = (s(rflags.provider) ?? "anthropic") as "anthropic";
            addRemote({
              label, provider, store_id: storeId,
              default_confidence: Number(rflags["default-confidence"] ?? 0.85),
              push: false,
            });
            out({ added: label, store_id: storeId, provider });
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
          case "ls":
          case "list": {
            out(loadRemoteConfigs().map((r) => ({
              label: r.label, provider: r.provider, store_id: r.store_id,
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
            fail(`unknown remote sub-command: ${subCmd ?? "(none)"}. Try: add, pull, ls, rm`);
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
