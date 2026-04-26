# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

KNDL v2 ("kindle") is the **smart format layer for Anthropic Memory** — a JSON-LD vocabulary for time-aware, source-aware, contradiction-aware facts.

```
Anthropic Memory  =  WHERE   filesystem, persistence, permissions
KNDL              =  WHAT    the format of files Claude writes (.fact.json)
kndl-mcp / CLI    =  HOW     query, decay, provenance, sync
```

Every fact is an immutable JSON-LD file. Every assertion carries confidence, decay, provenance, bitemporal validity, and a supersession chain.

## Repository Structure

```
packages/kndl-memory/   @kndl/memory — TypeScript library + MCP server + CLI
  src/
    core.ts             decay math, fact construction, applyQuery, findContradictions
    types.ts            Fact, FactInput, QueryOptions, FactStore interface
    stores/             fs.ts · sqlite.ts · duckdb.ts · supabase.ts + makeStore()
    remote/             Anthropic Memory Store sync (pull + push)
      anthropic.ts      REST client + FakeMemoryStoreClient
      sync.ts           pull() · push() · syncBoth()
      config.ts         ~/.kndl/remotes.json management
      types.ts          MemoryStoreClient, RemoteConfig, SyncResult, PushResult
    notify.ts           NotifyingStore, SubscriptionRegistry, attachFsWatcher
    server.ts           kndl-memory-mcp MCP server (stdio + HTTP)
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
| `packages/kndl-memory` | TypeScript 5.4 | pnpm · tsup · vitest · node:test |
| `website` | TypeScript / React 19 | pnpm · Vite · React Router 7 |

Node.js ≥ 22 required (`better-sqlite3` is a native addon; must be compiled for the running Node version).

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

Key rules: one file per fact, files are immutable, updates use `supersedes`.

## kndl-memory Package

### Build & test

```bash
cd packages/kndl-memory
pnpm install
pnpm build       # tsup → dist/
pnpm test        # 40 passing tests (vitest + node:test)
```

### Storage backends (`KNDL_STORAGE`)

| Prefix | Backend | Default? |
|---|---|---|
| `fs:./memory` | Filesystem — one `.fact.json` per fact | ✓ (Anthropic Memory) |
| `sqlite:./kndl.db` | SQLite WAL | recommended for standalone |
| `duckdb:./kndl.duckdb` | DuckDB columnar | analytical |
| `supabase:<url>?key=<anon>` | Supabase + RLS | multi-tenant cloud |

`better-sqlite3` is a native Node addon. If you switch Node versions via nvm, run `npm rebuild better-sqlite3` in `packages/kndl-memory`.

### MCP server

```bash
# stdio (Claude Desktop)
node dist/server.js

# HTTP (Goose, LM Studio, multi-client)
LOG_LEVEL=DEBUG node dist/server.js --http
# → http://localhost:8000/mcp
```

### CLI

```bash
# After pnpm build, run directly:
node dist/cli.js add --statement "..." --confidence 0.9 --source "human://gleb"

# Or link globally:
npm link    # makes `kndl` available on PATH
kndl help
```

### Remote sync

```bash
# Register a remote (pull only, default)
kndl remote add --provider anthropic --store-id store_abc --label personal

# Register with push enabled
kndl remote add --provider anthropic --store-id store_abc --label work --push --push-tag push-to-anthropic

kndl remote pull personal      # Anthropic → local
kndl remote push work          # local → Anthropic (tagged facts, no classified data)
kndl remote sync work          # pull then push
kndl remote ls                 # list all remotes
kndl remote rm personal        # remove
```

Push selects facts tagged with `push_tag` (default `push-to-anthropic`) and skips classified facts (`PHI`, `PII`, etc.) by default. Idempotent via `metadata.kndl_id`.

## MCP tools (11)

`assert_fact` · `query_facts` · `contradictions` · `supersede_fact` · `as_of` · `provenance_chain` · `subscribe` · `unsubscribe` · `list_subscriptions` · `sync_memory_store` · `list_memory_stores`

`sync_memory_store` accepts `direction: "pull" | "push" | "both"`.

`query_facts` accepts `text` for case-insensitive substring search across `statement` + `subject` (use when you don't know the exact subject URI).

## Website

```bash
cd website
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # → dist/ (prerendered 6 route shells)
```

Routes: `/` · `/protocol` · `/skill` · `/examples` · `/explorer` · `/mcp` · `/eval`

The `EvalPage` fetches `/eval/results.json` at runtime. To populate it:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
make publish-eval
```

## Key files to know

- `src/core.ts` — `applyQuery()`, `findContradictions()`, `buildProvenanceChain()`, `effectiveConfidence()`
- `src/stores/index.ts` — `makeStore()` factory (dispatches on `KNDL_STORAGE`)
- `src/remote/sync.ts` — `pull()`, `push()`, `syncBoth()`
- `src/server.ts` — `makeServer()` factory (one instance per HTTP connection)
- `skills/kndl-memory/SKILL.md` — the Claude Skill conventions
