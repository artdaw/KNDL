# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

KNDL v2 ("kindle") is the **smart format layer for Anthropic Memory** — a JSON-LD vocabulary for time-aware, source-aware, contradiction-aware facts.

```
Anthropic Memory  =  WHERE   filesystem, persistence, permissions
KNDL              =  WHAT    the format of files Claude writes (.fact.json)
kndl-mcp / CLI    =  HOW     query, decay, provenance, sync
```

## Repository Structure

```
packages/kndl-memory/   @kndl/memory — TypeScript library + MCP server + CLI
  src/
    core.ts             decay math, fact construction, applyQuery, findContradictions
    types.ts            Fact, FactInput, QueryOptions, FactStore interface
    stores/             fs.ts · sqlite.ts · duckdb.ts · supabase.ts + makeStore()
    remote/
      types.ts          MemoryStore, Memory, MemoryVersion, MemoryStoreClient interface
      anthropic.ts      AnthropicMemoryClient (full REST API) + FakeMemoryStoreClient
      sync.ts           pull() · push() · syncBoth()
      config.ts         ~/.kndl/remotes.json management
    notify.ts           NotifyingStore, SubscriptionRegistry, attachFsWatcher
    server.ts           kndl-memory-mcp MCP server (stdio + HTTP, 23 tools)
    cli.ts              kndl CLI binary

skills/kndl-memory/     Claude Skill bundle
  SKILL.md              drop into /memory/skills/
  context/v1.jsonld      vendored JSON-LD @context
  examples/             8 domain bundles, 42 facts
  eval/                 33-question eval suite + results.json

website/                docs site — kndl.artdaw.com
  src/pages/            LandingPage · ProtocolPage · SkillPage · ExamplesPage
                        ExplorerPage · McpPage · EvalPage
  src/components/       Nav · SEO · CodeBlock · JsonHighlight
  public/               context/ · schema/ · eval/ · skill/ · sitemap.xml
```

## Git Conventions

Semantic commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**NEVER include Co-Authored-By in commit messages.**

## Tech Stack

| Package | Language | Tools |
|---|---|---|
| `packages/kndl-memory` | TypeScript 5.4 | pnpm · tsup · node:test |
| `website` | TypeScript / React 19 | pnpm · Vite · React Router 7 |

Node.js ≥ 22. `better-sqlite3` is a native addon — if you switch Node versions via nvm, run `npm rebuild better-sqlite3` in `packages/kndl-memory/`.

## The Fact Shape

```json
{
  "@context": "https://kndl.artdaw.com/context/v1.jsonld",
  "@id":      "fact:alice-role-20260426t100000z-ab12cd34",
  "@type":    "Fact",
  "statement": "Alice is a staff engineer on the payments team",
  "subject":   "person:alice",
  "predicate": "role",
  "object":    "staff engineer, payments",
  "confidence": 0.95,
  "decay":      "0.5/180d",
  "source":     "human://gleb",
  "validFrom":  "2026-04-26T10:00:00Z",
  "recordedAt": "2026-04-26T10:00:00Z"
}
```

## kndl-memory Package

### Build & test

```bash
cd packages/kndl-memory
pnpm install
pnpm build       # tsup → dist/
npm test         # 43 passing tests (node:test)
```

### Storage backends (`KNDL_STORAGE`)

| Prefix | Backend | Default? |
|---|---|---|
| `fs:./memory` | Filesystem — one `.fact.json` per fact | ✓ (Anthropic Memory) |
| `sqlite:./kndl.db` | SQLite WAL | recommended for standalone |
| `duckdb:./kndl.duckdb` | DuckDB columnar | analytical |
| `supabase:<url>?key=<anon>` | Supabase + RLS | multi-tenant cloud |

### MCP server

```bash
node dist/server.js              # stdio (Claude Desktop)
LOG_LEVEL=DEBUG node dist/server.js --http  # HTTP port 8000 with debug logging
```

### CLI

```bash
node dist/cli.js help            # run directly
npm link && kndl help            # or link globally
```

## MCP Tools (23 total)

### Fact memory (11)

`assert_fact` · `query_facts` (supports `text` substring search) · `contradictions` · `supersede_fact` · `as_of` · `provenance_chain` · `subscribe` · `unsubscribe` · `list_subscriptions` · `sync_memory_store` (direction: pull|push|both) · `list_memory_stores`

### Anthropic Memory Store management (12, require `ANTHROPIC_API_KEY`)

**Store CRUD:** `create_memory_store` · `list_all_stores` · `get_memory_store` · `update_memory_store` · `delete_memory_store` · `archive_memory_store`

**Memory CRUD:** `list_memories` (supports `path_prefix`) · `get_memory` · `create_memory` · `update_memory` · `delete_memory`

## Anthropic Memory Stores API

Base URL: `https://api.anthropic.com`
Auth: `x-api-key` header
Beta: `anthropic-beta: memory-stores-2025-08-01`

Key resources:
- `POST /v1/memory_stores` — create store
- `GET  /v1/memory_stores/{id}/memories` — list memories (use `?view=full` for content)
- `POST /v1/memory_stores/{id}/memories` — create memory (requires `path` + `content`)
- `GET  /v1/memory_stores/{id}/memory_versions` — audit trail
- Memories have filesystem-like `path` (e.g. `/notes/alice.md`, `/kndl-facts/fact-...`)
- KNDL pushed facts land at `/kndl-facts/{slugified-fact-id}`

## Remote Sync

### Pull (Anthropic → local)
- Lists memories with `view=full`, translates each to a Fact
- Source URI: `anthropic-memory://{storeId}{path}`
- Idempotent via content-hash tag; supersedes on content change

### Push (local → Anthropic)
- Selects facts tagged `push-to-anthropic` (configurable via `push_tag`)
- Skips classified facts (PHI/PII/etc.) by default
- Creates memories at `/kndl-facts/{slugified-fact-id}`
- Idempotent: skips paths already present in the store

```bash
kndl remote add --provider anthropic --store-id store_abc --label work --push
kndl add ... --tags push-to-anthropic
kndl remote push work      # push tagged facts
kndl remote sync work      # pull + push
```

### Memory Store management CLI (requires `ANTHROPIC_API_KEY`)

```bash
# Store CRUD
kndl store create  --name "My Store" [--description "..."]
kndl store ls      [--archived]
kndl store get     <store_id>
kndl store update  <store_id> [--name "..."] [--description "..."]
kndl store delete  <store_id>
kndl store archive <store_id>

# Memory CRUD — paths are filesystem-style (/notes/alice.md, /kndl-facts/...)
kndl memory create  --store <id> --path <path> --content <text>
kndl memory ls      --store <id> [--prefix <path>]
kndl memory get     --store <id> <memory_id>
kndl memory update  --store <id> <memory_id> [--content <t>] [--path <p>]
kndl memory delete  --store <id> <memory_id>

# Each has --help:
kndl store help
kndl memory help
```

## Website

```bash
cd website && pnpm install && pnpm dev
pnpm build   # → dist/ (6 prerendered route shells)
```

Routes: `/` · `/protocol` · `/skill` · `/examples` · `/explorer` · `/mcp` · `/eval`

`EvalPage` fetches `/eval/results.json` at runtime. Populate with:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
make publish-eval
```

## Key Files

- `src/core.ts` — `applyQuery()`, `findContradictions()`, `effectiveConfidence()`
- `src/stores/index.ts` — `makeStore()` factory
- `src/remote/anthropic.ts` — `AnthropicMemoryClient` (full API) + `FakeMemoryStoreClient`
- `src/remote/sync.ts` — `pull()`, `push()`, `syncBoth()`
- `src/server.ts` — `makeServer()` factory (one instance per HTTP connection)
- `skills/kndl-memory/SKILL.md` — the Claude Skill conventions
