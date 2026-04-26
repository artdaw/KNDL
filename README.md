# KNDL — Knowledge Node Data Link

**The format Anthropic Memory was waiting for.**

[![CI](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml/badge.svg)](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml)

> Anthropic just shipped Memory for agents — a filesystem. But filesystems are dumb about confidence, time, and source. Agents fill them with markdown that can't be queried, won't decay, and loses provenance the moment it's written.
>
> KNDL is the format that makes Memory actually smart.

```
Anthropic Memory  =  WHERE   (filesystem, persistence, permissions)
KNDL              =  WHAT    (the format of files Claude writes)
kndl-mcp / CLI    =  HOW     (query, decay, contradiction detection, provenance)
```

## The fact shape

One immutable JSON-LD file per assertion. Every fact carries:

```json
{
  "@context": "https://kndl.artdaw.com/context/v1.jsonld",
  "@id":      "fact:customer-9281-creditscore-20260426t100000z-ab12cd34",
  "@type":    "Fact",
  "statement": "Customer 9281 has a credit score of 720",
  "subject":   "customer:9281",
  "predicate": "creditScore",
  "object":    720,
  "confidence": 0.95,
  "decay":      "0.5/30d",
  "source":     "https://api.experian.com/v1/scores/9281",
  "validFrom":  "2026-04-26T10:00:00Z",
  "recordedAt": "2026-04-26T10:00:00Z"
}
```

`decay: "0.5/30d"` → confidence halves every 30 days. Effective confidence at query time:
`confidence × rate ^ (elapsed / window)`

**Facts are immutable.** To update a fact, write a new one with `supersedes` pointing at the old one. The old fact stays on disk — visible for `as_of` time-travel, hidden from active queries.

## What KNDL adds over plain markdown

| | Markdown | KNDL |
|---|---|---|
| Know when a fact went stale | ✗ | ✓ decay + effective_confidence |
| Surface contradictions | ✗ | ✓ contradictions() ranked by recency + confidence |
| Trace claims to sources | ✗ | ✓ source URI + derivedFrom chain |
| Time-travel ("what did we believe on date X") | ✗ | ✓ as_of bitemporal query |
| Open-world negation ("no known allergy") | ✗ | ✓ negated: true |
| Sensitivity gating | ✗ | ✓ classification: PHI filtered by default |

## Install (MCP server + CLI)

```bash
git clone https://github.com/artdaw/kndl
cd kndl/packages/kndl-memory
pnpm install
pnpm build

# Two binaries:
node dist/server.js          # kndl-memory-mcp — MCP server (stdio)
node dist/server.js --http   # kndl-memory-mcp — MCP server (HTTP, port 8000)
node dist/cli.js             # kndl — CLI
```

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kndl": {
      "command": "node",
      "args": ["/path/to/kndl/packages/kndl-memory/dist/server.js"],
      "env": { "KNDL_STORAGE": "sqlite:///Users/you/.kndl/memory.db" }
    }
  }
}
```

Fully quit Claude Desktop (Cmd-Q) and reopen. Ask: *"Remember that Alice is a staff engineer with confidence 0.95."*

## Anthropic Memory (Skill)

Copy `skills/kndl-memory/SKILL.md` into your `/memory/skills/` directory. Claude follows the conventions automatically — writes `.fact.json` files, queries with `kndl query`, applies trust thresholds.

```
KNDL_STORAGE=fs:/memory  # use the Anthropic Memory filesystem directly
```

## MCP tools (9)

| Tool | What it does |
|------|--------------|
| `assert_fact` | Write a new immutable fact |
| `query_facts` | Read active facts with effective confidence at as_of |
| `contradictions` | Find disagreeing facts, ranked by recency + confidence |
| `supersede_fact` | Replace a fact (preserves history for time-travel) |
| `as_of` | Bitemporal: what did memory believe at timestamp X |
| `provenance_chain` | Walk derivedFrom + supersedes backward |
| `sync_memory_store` | Pull from an Anthropic Memory Store (ANTHROPIC_API_KEY required) |
| `list_memory_stores` | List configured remote stores |
| `subscribe` | Get notified when a fact changes |

## Storage backends

| `KNDL_STORAGE` | Backend | When to use |
|---|---|---|
| `fs:./memory` | Filesystem (one file/fact) | **Anthropic Memory mount** |
| `sqlite:./kndl.db` | SQLite | **Default for standalone** — WAL, indexed |
| `duckdb:./kndl.duckdb` | DuckDB | Analytical workloads |
| `supabase:<url>?key=<anon>` | Supabase | Multi-tenant cloud |

## Migrating from KNDL v1

```bash
kndl migrate --from sqlite:///path/to/kndl-v1.db --to ./memory
```

Maps v1 Nodes, Edges, and Intents to KNDL v2 Facts. All facts tagged `v1-migration`.

## Repository layout

```
packages/kndl-memory/   @kndl/memory npm package
  src/
    core.ts             decay math, fact construction, query algorithms
    types.ts            Fact, FactInput, FactStore interface
    stores/             fs, sqlite, duckdb, supabase backends + factory
    remote/             Anthropic Memory Store sync (pull)
    notify.ts           change detection + MCP notification broadcast
    server.ts           kndl-memory-mcp MCP server
    cli.ts              kndl CLI
  eval/
    runner.ts           eval runner (Claude-as-judge, 33 questions)
  tests/                vitest + node:test, 36 passing

skills/kndl-memory/     Claude Skill bundle
  SKILL.md              drop into /memory/skills/
  context/v1.jsonld     vendored JSON-LD context
  examples/             8 domain fact bundles (42 facts total)
  eval/questions.json   33-question eval suite

website/                docs site (React + Vite)
```

## Eval quality bar

Run `tsx packages/kndl-memory/eval/runner.ts` with `ANTHROPIC_API_KEY`.
KNDL must beat vanilla (facts pasted in system prompt) on ≥70% of 33 questions to ship.
If it doesn't, fix the protocol first.

## License

MIT
