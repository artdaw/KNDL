# kndl-memory

**Confidence-, time-, and provenance-aware memory for AI agents.**

A JSON-LD vocabulary + Claude Skill + MCP server + CLI that turns any
filesystem memory (including
[Anthropic Memory on Managed Agents](https://www.anthropic.com/engineering/managed-agents))
into a knowledge store that knows *when* a fact was learned, *who* said it,
*how confident* we are, and *whether it's still trustworthy*.

```
Anthropic Memory  =  filesystem  (where files live)
KNDL              =  format       (what files contain)
Skill / CLI / MCP =  conventions  (how Claude reads & writes)
```

## Why

Anthropic just shipped Memory: a filesystem agents can write to. They were
deliberately unopinionated about format. Without conventions, agents fill
that filesystem with markdown that:

- can't tell when a fact has gone stale
- can't surface contradictions
- can't trace claims to sources
- can't time-travel ("what did we believe last Tuesday?")

KNDL is the missing convention layer. Drop it into your Memory store and
Claude starts reasoning about *what's trustworthy*, not just *what's written*.

## Repo layout

```
kndl-memory/                    ← the Skill (drag-and-drop into your skills dir)
  SKILL.md                      Skill instructions Claude follows
  context/v1.jsonld             JSON-LD @context (also at kndl.artdaw.com)
  eval/questions.json           8-question eval to score KNDL vs vanilla JSON
  examples/                     5-fact loan-decision demo dataset

kndl-memory-mcp/                ← the npm package (one source of truth)
  src/core.ts                   shared store: decay, query, contradictions, supersession
  src/cli.ts                    `kndl` binary — the Skill calls this via bash
  src/server.ts                 `kndl-memory-mcp` binary — MCP server
  package.json                  exposes both binaries
```

The CLI and the MCP server share `core.ts`. One language, one decay
implementation, one set of bugs.

## Install

```bash
cd kndl-memory-mcp
npm install
npm run build
npm link                        # makes `kndl` and `kndl-memory-mcp` available system-wide
```

That installs two binaries:

- **`kndl`** — the CLI the Skill invokes from bash
- **`kndl-memory-mcp`** — the MCP server for Claude Desktop / Claude Code / Cursor / etc.

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kndl-memory": {
      "command": "kndl-memory-mcp",
      "env": { "KNDL_MEMORY_DIR": "/absolute/path/to/your/memory" }
    }
  }
}
```

For the Skill: copy `kndl-memory/` into your project's skills directory
(or `/memory/skills/` if you're using Anthropic Memory). The Skill activates
automatically when Claude needs to read or write facts and shells out to the
`kndl` CLI.

## Quickstart

```bash
export KNDL_MEMORY_DIR=./memory

kndl add \
  --statement "Customer 9281 has a credit score of 720" \
  --subject customer:9281 --predicate creditScore --object 720 \
  --confidence 0.95 --source "https://api.experian.com/9281" \
  --decay "0.5/30d" --valid-from now

kndl query --subject customer:9281 --as-of now
kndl contradictions --subject customer:9281
kndl provenance --id <fact-id>
```

## The fact shape

```json
{
  "@context": "./context/v1.jsonld",
  "@id":      "fact:cust-9281-credit-2026-04-23",
  "@type":    "Fact",
  "statement": "Customer 9281 has a credit score of 720",
  "subject":   "customer:9281",
  "predicate": "creditScore",
  "object":    720,
  "confidence": 0.95,
  "decay":      "0.5/30d",
  "source":     "https://api.experian.com/v1/scores/9281",
  "validFrom":  "2026-04-23T10:00:00Z",
  "recordedAt": "2026-04-23T10:00:00Z"
}
```

## The unique fields (vs. JSON-LD baseline)

These are what make KNDL more than "JSON with a schema":

- **`confidence`** — scalar 0–1, epistemic certainty
- **`decay`** — `<rate>/<window>`, applied as `effective = confidence × rate^(elapsed/window)`
- **`validFrom` / `validUntil` / `observedAt` / `recordedAt`** — bitemporal, three distinct clocks
- **`supersedes`** — explicit version chain (immutable history with hidden-by-default)
- **`derivedFrom` / `inference`** — provenance graph for inferred facts
- **`negated`** — open-world strong negation ("known false" ≠ "absent")
- **`classification` / `consent`** — sensitivity gating (PHI/PII)
- **`tenant`** — multi-tenant isolation, refused without explicit override

## CLI commands and matching MCP tools

| CLI command            | MCP tool            | What it does                                                            |
|------------------------|---------------------|-------------------------------------------------------------------------|
| `kndl add`             | `assert_fact`       | Write a new fact                                                        |
| `kndl query`           | `query_facts`       | Read active facts with effective confidence at as_of time               |
| `kndl contradictions`  | `contradictions`    | Find disagreeing active facts about the same subject/predicate          |
| `kndl supersede`       | `supersede_fact`    | Write a fact replacing an older one (preserves history)                 |
| `kndl query --as-of`   | `as_of`             | Bitemporal time-travel ("what did we know on date X")                   |
| `kndl provenance`      | `provenance_chain`  | Walk derivedFrom + supersedes backward to surface the audit trail       |

Same shared `core.ts` underneath. Whatever you can do with the CLI, you can
do via MCP, with identical output.

## The eval

Run `kndl-memory/eval/questions.json` against 
(a) Claude with the JSON facts
pasted in the system prompt, and 
(b) Claude with the MCP server connected.
Score each question binary right/wrong.

KNDL should clearly win on:

- **decayed confidence** (vanilla trusts a 633-day-old "employed at ACME" fact)
- **supersession** (vanilla returns the wrong credit score after an update)
- **as-of queries** (vanilla can't time-travel reliably)
- **contradictions** (vanilla picks arbitrarily, no provenance ranking)

If KNDL doesn't win at least 5/8 questions, the architecture isn't paying
for itself yet. Pivot or fix.

## Status

Hackathon-quality. These work end-to-end (verified via JSON-RPC round-trip
and via the CLI):

- `kndl add` / `query` / `contradictions` / `supersede` / `provenance` / `list` / `show`
- All 6 MCP tools wired to the same `core.ts`
- Decay math verified: BTC at 0.95 confidence with `0.5/4h` decay reads 0.2375 after 8 hours
- Bitemporal `recordedAt` filtering correct
- Supersession hides from active queries, preserves for as-of
- Contradiction ranking: not-negated → newer recorded → higher effective_confidence → shorter chain

Not yet shipped:

- Cryptographic signature verification (`signature` field is read but not validated)
- `uncertainty` distribution types (round-trippable but not used in reasoning)
- Vector index for semantic similarity (out of scope; pair with a separate vector DB)

## License

MIT.
