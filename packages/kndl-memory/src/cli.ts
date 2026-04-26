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
// Env: KNDL_MEMORY_DIR (default ./memory)

import { FactStore, type FactInput } from "./core.js";

const MEMORY_DIR = process.env.KNDL_MEMORY_DIR ?? "./memory";

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
        // collect contiguous non-flag values into an array if more than one
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

function require_(v: string | undefined, name: string): string {
  if (v === undefined) {
    fail(`missing required --${name}`);
  }
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
    statement: require_(s(flags.statement), "statement"),
    confidence: conf,
    source: require_(s(flags.source), "source"),
    subject: s(flags.subject),
    predicate: s(flags.predicate),
    object,
    decay: s(flags.decay),
    validFrom: s(flags["valid-from"]),
    validUntil: s(flags["valid-until"]),
    observedAt: s(flags["observed-at"]),
    classification: s(flags.classification),
    consent: s(flags.consent),
    tenant: s(flags.tenant),
    derivedFrom: arr(flags["derived-from"]),
    negated: b(flags.negated),
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
  help             Show this message

Env:
  KNDL_MEMORY_DIR  Memory root directory (default ./memory)

Run \`kndl <command> --help\` for command-specific options, or read the SKILL.md.
`;

function main(argv: string[]): number {
  const cmd = argv[0];
  const { flags } = parseArgs(argv.slice(1));

  if (!cmd || cmd === "help" || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const store = new FactStore(MEMORY_DIR);

  try {
    switch (cmd) {
      case "add": {
        const r = store.assertFact(buildInput(flags));
        out({ id: r.id, path: r.path });
        return 0;
      }
      case "supersede": {
        const oldId = require_(s(flags["old-id"]), "old-id");
        const r = store.supersedeFact(oldId, buildInput(flags));
        out({ id: r.id, supersedes: r.supersedes, path: r.path });
        return 0;
      }
      case "query": {
        const r = store.query({
          subject: s(flags.subject),
          predicate: s(flags.predicate),
          asOf: s(flags["as-of"]),
          minConfidence: n(flags["min-confidence"]),
          tenant: s(flags.tenant),
          allowPhi: b(flags["allow-phi"]),
        });
        out(r);
        return 0;
      }
      case "contradictions": {
        out(store.contradictions({ subject: s(flags.subject), predicate: s(flags.predicate) }));
        return 0;
      }
      case "provenance": {
        const id = require_(s(flags.id), "id");
        const maxDepth = n(flags["max-depth"]);
        out(store.provenanceChain(id, maxDepth));
        return 0;
      }
      case "list": {
        out(store.list(s(flags.subject)));
        return 0;
      }
      case "show": {
        const id = require_(s(flags.id), "id");
        const f = store.show(id);
        if (!f) {
          process.stderr.write(`not found: ${id}\n`);
          return 1;
        }
        out(f);
        return 0;
      }
      default:
        fail(`unknown command: ${cmd}. Run \`kndl help\` for usage.`);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

process.exit(main(process.argv.slice(2)));
