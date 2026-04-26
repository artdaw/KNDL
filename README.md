<div align="center">

<img src="kndl.png" alt="KNDL" width="100%" />

# KNDL — Knowledge Node Data Link

**The format Anthropic Memory was waiting for**

[![CI](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml/badge.svg)](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-00e5a0.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6.svg)](packages/kndl-memory)
[![Website](https://img.shields.io/badge/Website-kndl.artdaw.com-00e5a0?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJhMTAgMTAgMCAxIDAgMCAyMEExMCAxMCAwIDAgMCAxMiAyek04IDEyYTQgNCAwIDEgMSA4IDAgNCA0IDAgMCAxLTggMHoiLz48L3N2Zz4=)](https://kndl.artdaw.com)

### **[→ kndl.artdaw.com](https://kndl.artdaw.com)** — live docs, protocol reference, interactive examples, explorer

</div>

---

Anthropic just shipped Memory for agents — a filesystem.
But filesystems are dumb about confidence, time, and source.
Agents fill them with markdown that **can't be queried, won't decay, and loses provenance the moment it's written.**

**KNDL is the format that makes Memory actually smart.**

```
Anthropic Memory  =  WHERE   filesystem, persistence, permissions
KNDL              =  WHAT    the format of files Claude writes
kndl-mcp / CLI    =  HOW     query, decay, contradiction detection, provenance
```

---

## Get started in 60 seconds

```bash
git clone https://github.com/artdaw/kndl
cd kndl/packages/kndl-memory
pnpm install && pnpm build
```

Add to **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

> **If you use nvm**, specify the full node path so Claude Desktop uses the right version:
> `"command": "/Users/you/.nvm/versions/node/v24.9.0/bin/node"`

Restart Claude Desktop. Now ask: *"Remember that Alice is a staff engineer with confidence 0.95."*

---

## Why not just markdown?

| | Markdown | **KNDL** |
|---|:---:|:---:|
| Know when a fact went stale | ✗ | ✅ decay + `effective_confidence` |
| Surface contradictions between sources | ✗ | ✅ ranked by recency + confidence |
| Trace a claim to its origin | ✗ | ✅ `source` URI + `derivedFrom` chain |
| Time-travel ("what did we believe last week?") | ✗ | ✅ `as_of` bitemporal query |
| Open-world negation ("no known allergy") | ✗ | ✅ `negated: true` |
| PHI / PII sensitivity gating | ✗ | ✅ `classification` filtered by default |

---

## The fact shape

One immutable file per assertion. Every fact is a JSON-LD document:

```json
{
  "@context": "https://kndl.artdaw.com/context/v1.jsonld",
  "@id":       "fact:alice-role-20260426t100000z-ab12cd34",
  "@type":     "Fact",
  "statement":  "Alice is a staff engineer on the payments team",
  "subject":    "person:alice",
  "predicate":  "role",
  "object":     "staff engineer, payments",
  "confidence": 0.95,
  "decay":      "0.5/180d",
  "source":     "human://gleb",
  "validFrom":  "2026-04-26T10:00:00Z",
  "recordedAt": "2026-04-26T10:00:00Z"
}
```

`decay: "0.5/180d"` — confidence halves every 180 days.
**Facts are immutable.** Updates use `supersedes`; history preserved for time-travel.

---

## MCP tools (23)

### Fact memory (11)

| Tool | What it does |
|------|-------------|
| `assert_fact` | Write a new immutable fact |
| `query_facts` | Read active facts with decay-adjusted confidence. Use `subject` for exact match or `text` for substring search. |
| `contradictions` | Find conflicting facts, ranked by recency + confidence |
| `supersede_fact` | Replace a fact — history preserved for time-travel |
| `as_of` | Bitemporal: what did memory believe at timestamp X? |
| `provenance_chain` | Walk `derivedFrom` + `supersedes` backward |
| `subscribe` / `unsubscribe` / `list_subscriptions` | Fact change notifications |
| `sync_memory_store` | Sync a configured remote — `direction: "pull" \| "push" \| "both"` |
| `list_memory_stores` | List configured remotes + last-sync timestamps |

### Memory Store management (12, all require `ANTHROPIC_API_KEY`)

| Tool | What it does |
|------|-------------|
| `create_memory_store` | Create a new Anthropic Memory Store |
| `list_all_stores` | List all Memory Stores in your account |
| `get_memory_store` | Get details of a store by ID |
| `update_memory_store` | Rename or update a store |
| `delete_memory_store` | Permanently delete a store |
| `archive_memory_store` | Archive a store (soft delete) |
| `list_memories` | List memories in a store (supports `path_prefix` filter) |
| `get_memory` | Get a memory by ID (returns full content) |
| `create_memory` | Create a memory at a given path |
| `update_memory` | Update memory content or path |
| `delete_memory` | Delete a memory |

---

## Storage

| `KNDL_STORAGE` | Backend | Use case |
|---|---|---|
| `fs:/memory` | Filesystem `.fact.json` files | **Anthropic Memory mount** |
| `sqlite:./kndl.db` | SQLite WAL | **Claude Desktop standalone** ← default |
| `duckdb:./kndl.duckdb` | DuckDB columnar | Analytical workloads |
| `supabase:<url>?key=<anon>` | Supabase + RLS | Multi-tenant cloud |

---

## CLI

After `pnpm build`, the binary is at `dist/cli.js`. Make it available as `kndl`:

```bash
# Option A — link globally
cd packages/kndl-memory && npm link

# Option B — shell alias
alias kndl="node /path/to/kndl/packages/kndl-memory/dist/cli.js"

# Option C — run directly
node packages/kndl-memory/dist/cli.js help
```

### Fact commands

```bash
export KNDL_STORAGE=sqlite:./kndl.db

kndl add \
  --statement "Alice is a staff engineer, payments" \
  --subject person:alice --predicate role \
  --confidence 0.95 --source "human://gleb" \
  --decay "0.5/180d" --valid-from now

kndl query --subject person:alice        # exact subject match
kndl query --text alice                  # substring search
kndl contradict --subject person:alice
kndl as-of 2026-01-01T00:00:00Z --subject person:alice
kndl provenance --id fact:alice-role-...
```

### Remote sync commands

```bash
# Pull-only remote
kndl remote add --provider anthropic --store-id store_abc --label personal
kndl remote pull personal

# Push-enabled remote
kndl remote add --provider anthropic --store-id store_abc --label work --push
kndl add ... --tags push-to-anthropic   # tag facts to push
kndl remote push work
kndl remote sync work   # pull + push
kndl remote ls
```

Push selects facts tagged `push-to-anthropic` and skips classified data by default.
Memories are stored at `/kndl-facts/{fact-id}` in the Memory Store.

### Memory Store management (requires `ANTHROPIC_API_KEY`)

```bash
# Store CRUD
kndl store create  --name "My Store" --description "optional"
kndl store ls      [--archived]
kndl store get     <store_id>
kndl store update  <store_id> --name "New Name"
kndl store delete  <store_id>
kndl store archive <store_id>

# Memory CRUD (filesystem-style paths)
kndl memory create  --store <store_id> --path /notes/alice.md --content "Alice is a staff engineer"
kndl memory ls      --store <store_id> [--prefix /notes/]
kndl memory get     --store <store_id> <memory_id>
kndl memory update  --store <store_id> <memory_id> --content "Updated content"
kndl memory delete  --store <store_id> <memory_id>
```

---

## Use with Anthropic Memory (Skill)

```bash
cp -r skills/kndl-memory/SKILL.md   ./memory/skills/
cp -r skills/kndl-memory/context/   ./memory/context/
```

---

## HTTP server (multi-agent)

```bash
KNDL_STORAGE=sqlite:./shared.db node packages/kndl-memory/dist/server.js --http
# → http://localhost:8000/mcp

LOG_LEVEL=DEBUG ... node dist/server.js --http   # per-request debug logging
```

---

## Repository

```
packages/kndl-memory/     @kndl/memory npm package (TypeScript, Node >=22)
  src/
    core.ts               decay math, fact construction, query algorithms
    types.ts              Fact, FactInput, QueryOptions, FactStore interface
    stores/               fs · sqlite · duckdb · supabase + makeStore()
    remote/
      types.ts            MemoryStore, Memory, MemoryVersion, MemoryStoreClient
      anthropic.ts        AnthropicMemoryClient (full API) + FakeMemoryStoreClient
      sync.ts             pull() · push() · syncBoth()
      config.ts           ~/.kndl/remotes.json management
    server.ts             kndl-memory-mcp (stdio + HTTP, 23 tools)
    cli.ts                kndl CLI
  tests/                  43 passing tests

skills/kndl-memory/       Claude Skill bundle
  SKILL.md                drop into /memory/skills/
  context/v1.jsonld        JSON-LD @context
  examples/               8 domain bundles · 42 facts

website/                  kndl.artdaw.com (React + Vite, 7 pages)
```

---

## Eval

```bash
export ANTHROPIC_API_KEY=sk-ant-...
make publish-eval
```

KNDL must beat vanilla on ≥ 70% of 33 questions to ship.

---

## License

MIT — [kndl.artdaw.com](https://kndl.artdaw.com)
