---
name: kndl-memory
description: |
  Use this skill whenever you persist a fact to a memory filesystem, read facts back, or
  answer a question that requires recall from prior sessions. The skill stores each fact as
  a JSON-LD document with confidence, decay, bitemporal validity, provenance, and supersession,
  so an agent's memory can reason about what is fresh, what is stale, what is contradicted,
  and what came from where. Triggers: writing to /memory, reading from /memory, claims like
  "I learned that…", "I'll remember…", questions like "what did we decide…", "how confident
  are we in…", "who told us…", "is this still true". Do NOT trigger for ephemeral chat-only
  scratchpads or single-turn arithmetic. Pairs naturally with Anthropic's Memory on Managed
  Agents: KNDL is the file format inside the Memory store, this skill is the convention set
  Claude follows when reading/writing those files.
---

# KNDL Memory Skill

KNDL ("Knowledge Node Data Link") makes filesystem memory time-aware, source-aware, and contradiction-aware.
Without it, agents accumulate flat markdown notes and lose the ability to tell what's
trustworthy. This skill is a small set of conventions Claude follows whenever it reads
or writes facts to a memory directory.

## Memory layout

```
/memory/
  facts/                 # one JSON-LD file per fact
    <slug>.fact.json
  context/
    v1.jsonld            # vendored @context (also at https://kndl.artdaw.com/context/v1.jsonld)
  inferences/            # optional: rules that produced derived facts
    <slug>.rule.json
```

One fact per file. Files are immutable. To "update" a fact, write a new file with
`supersedes` pointing at the old one's `@id` (the `kndl supersede` command does this).

## The fact shape

```json
{
  "@context": "./context/v1.jsonld",
  "@id":     "fact:cust-9281-credit-score-2026-04-23",
  "@type":   "Fact",

  "statement":  "Customer 9281 has a credit score of 720",
  "subject":    "customer:9281",
  "predicate":  "creditScore",
  "object":     720,

  "confidence": 0.95,
  "decay":      "0.5/30d",

  "source":     "https://api.experian.com/v1/scores/9281",
  "validFrom":  "2026-04-23T10:00:00Z",
  "recordedAt": "2026-04-23T10:00:00Z"
}
```

## Required fields when writing a fact

| Field         | Required | Notes                                                       |
|---------------|----------|-------------------------------------------------------------|
| `@id`         | yes      | generated automatically; globally unique                    |
| `@type`       | yes      | usually `"Fact"`                                            |
| `statement`   | yes      | one-sentence plain-language assertion                       |
| `confidence`  | yes      | float in [0, 1]                                             |
| `source`      | yes      | URI; for human input use `human://<name>`                   |
| `recordedAt`  | yes      | set automatically; when this fact entered memory            |
| `validFrom`   | yes      | when the fact began being true in the world                 |

## Optional fields you should add when you have them

- `subject` / `predicate` / `object` — structured triple form, useful for queries
- `validUntil` — explicit end of validity (else valid until superseded)
- `observedAt` — when an agent or sensor *directly saw* the fact (vs. heard about it)
- `decay` — `"<rate>/<window>"`, e.g. `"0.5/30d"` halves confidence every 30 days
- `supersedes` — `@id` of the older fact this replaces
- `derivedFrom` — array of `@id`s if this fact was inferred from others
- `inference` — `@id` of the rule that did the inference
- `negated` — `true` means this fact is known false (open-world, not absence)
- `classification` — `"PII"`, `"PHI"`, `"PCI"`, etc.
- `consent` — `@id` of the consent scope (required if classification is PHI)
- `retention` — ISO duration or absolute date for scheduled deletion
- `tenant` — opaque string for multi-tenant isolation

## CLI installation

The skill relies on the `kndl` CLI binary. Build it once per environment, then it is
available for all bash tool calls.

```bash
# 1. Clone and build (one-time)
git clone https://github.com/artdaw/kndl
cd kndl/packages/kndl-memory
pnpm install
pnpm build

# 2. Make the binary available system-wide
npm link
# → `kndl` is now on PATH everywhere

# Verify:
kndl help
```

If you cannot use `npm link`, prefix every command with the full path:
```bash
node /path/to/kndl/packages/kndl-memory/dist/cli.js add ...
```

`KNDL_STORAGE` controls where facts live. Default is `fs:./memory` (a `facts/` subdirectory
relative to the working directory). Set it to match your memory mount:

```bash
export KNDL_STORAGE=fs:/memory   # Anthropic Memory filesystem mount
export KNDL_STORAGE=sqlite:./kndl-memory.db  # SQLite (recommended for Claude Desktop)
```

## Workflow

The `kndl` CLI shares its core implementation with the `kndl-memory-mcp` server — behavior
is identical whether you invoke it via bash or via MCP tools. Always use the bash tool to
invoke the CLI.

### 1. Before answering a question that needs recall

```bash
kndl query --subject customer:9281 --as-of now
```

Returns matching facts with their **effective confidence** (decay applied to the
`as-of` time). Use `effective_confidence` from the response, not the raw `confidence` field.

### 2. Before stating a fact you already know

```bash
kndl contradictions --subject customer:9281 --predicate creditScore
```

Lists conflicting assertions about the same subject/predicate. If any contradiction has
higher effective confidence than what you were about to say, defer to it and mention
the conflict.

### 3. When learning a new fact

```bash
kndl add \
  --statement "Customer 9281 has a credit score of 720" \
  --subject customer:9281 --predicate creditScore --object 720 \
  --confidence 0.95 --source "https://api.experian.com/v1/scores/9281" \
  --decay "0.5/30d" --valid-from now
```

Returns `{ "id": "fact:..." }`.

### 4. When a fact is superseded

```bash
kndl supersede --old-id fact:cust-9281-credit-score-2026-03-01 \
  --statement "Customer 9281 has a credit score of 740" \
  --subject customer:9281 --predicate creditScore --object 740 \
  --confidence 0.96 --source "https://api.experian.com/v1/scores/9281" \
  --decay "0.5/30d" --valid-from now
```

The old fact stays on disk; it is hidden from active queries but preserved for time-travel.

### 5. When the user asks "what did we believe on date X"

```bash
kndl query --subject customer:9281 --as-of 2026-03-15T00:00:00Z
```

Time-travel: filters to facts where `recordedAt <= as-of` and applies decay relative
to the as-of time, not now.

### 6. To see where a fact came from

```bash
kndl provenance --id fact:cust-9281-credit-score-2026-04-23
```

Walks `derivedFrom` and `supersedes` backward to surface the audit trail.

## Reasoning rules

When using facts in an answer:

1. **Trust thresholds.** Treat `effective_confidence ≥ 0.7` as usable.
   `0.3 ≤ effective < 0.7` is usable but flag uncertainty in the answer and recommend
   re-verification. `< 0.3` is stale; do not state as fact.

2. **Contradiction resolution.** When two non-superseded facts about the same
   subject/predicate disagree, prefer (in order):
   not negated → newer `recordedAt` → higher effective_confidence → shorter `derivedFrom` chain.
   If still tied, surface both to the user.

3. **Negation is a positive claim.** `negated: true` means *known false*. Absence
   of a fact means *unknown*. Never substitute one for the other. (Open-world assumption.)

4. **Cite your facts.** Every claim in a recall answer references the `@id` of the
   fact it relied on. Provenance chains compound: if a derived fact's source isn't
   trustworthy, the derived fact isn't either.

5. **Classification gates.** Never include facts with `classification: "PHI"` in
   responses unless a `consent` `@id` covers the current purpose. The query tool
   filters these by default; do not override without explicit user instruction.

## Decay formula

```
effective_confidence(t) = confidence × (rate ^ ((t − valid_from) / window))
```

Examples with `confidence = 0.9`:

| decay        | 1 day | 7 days | 30 days | 90 days |
|--------------|-------|--------|---------|---------|
| `0.5/24h`    | 0.450 | 0.007  | ≈0      | ≈0      |
| `0.5/7d`     | 0.802 | 0.450  | 0.045   | 0.000   |
| `0.5/30d`    | 0.880 | 0.756  | 0.450   | 0.112   |
| `0.5/180d`   | 0.897 | 0.876  | 0.808   | 0.638   |
| `0.5/365d`   | 0.898 | 0.888  | 0.852   | 0.748   |

Pick decay rates that match the natural staleness of the data:
- Sensor readings: hours to days
- Stock prices: minutes to hours
- Personal status (employment, address): months to years
- Identity, birth date, immutable identifiers: omit decay entirely

## What this skill does NOT do

- Multi-document transactions across facts (each write is atomic on its own file)
- Cross-tenant queries (the query tool refuses without explicit override)
- Embeddings or semantic similarity (use a separate vector index if you need it)
- Editing existing fact files (always supersede)

## Anti-patterns

- Setting `confidence: 1.0` on anything that isn't axiomatic. Reserve 1.0 for definitions.
- Reusing an `@id`. Every file is immutable; new fact = new id.
- Omitting `decay` on time-sensitive data. The default is no decay, which is wrong for
  almost any real-world observation.
- Inferring facts and not setting `derivedFrom`. Loses the audit trail.
- Writing to memory and not also writing the source. A fact without provenance is folklore.
