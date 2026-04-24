[![KNDL — Knowledge Node Description Language](./kndl.png)](./kndl.png)

# KNDL — Knowledge Node Description Language

Give your AI agent a memory it can reason over.

[![CI](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml/badge.svg)](https://github.com/artdaw/KNDL/actions/workflows/kndl-workflow.yml)
[![CodeQL](https://github.com/artdaw/KNDL/actions/workflows/codeql.yml/badge.svg)](https://github.com/artdaw/KNDL/actions/workflows/codeql.yml)

KNDL is a language for describing knowledge as a directed graph. Every fact is a **node** with typed fields. Relationships are **edges** with types and weights. Every assertion carries a **confidence score**, optional provenance, and a temporal validity window — so agents always know how much to trust what they know.

```kndl
node @sensor_t001 :: Temperature<°C> {
  value    = 22.5
  unit     = "°C"
  location -> @building_7
  ~confidence  0.94
  ~source      "sensor://bldg-7/t-001"
  ~valid       2026-04-10T14:00Z .. *
  ~decay       0.95 / 1h
  ~uncertainty Gaussian { mean = 22.5  stddev = 0.3 }
}

intent @overheat :: Action {
  trigger = @sensor_t001.value > 28.0
  do { emit node :: Alert { severity = "critical" } }
  ~priority 0.9
  ~cooldown 5m
}
```

## Why KNDL

Existing formats were designed for humans (Markdown), machines (JSON), or documents (XML). None were designed for **agents** — entities that need to reason about knowledge, track certainty, attribute provenance, and traverse relationships.

| Feature | JSON / YAML | KNDL |
|---------|-------------|------|
| Confidence scores | ✗ | ✓ native |
| Temporal decay | ✗ | ✓ native |
| Provenance tracking | ✗ | ✓ native |
| Typed graph edges | ✗ | ✓ native |
| Trigger-action intents | ✗ | ✓ native |
| Uncertainty distributions | ✗ | ✓ native |
| Parameterised types | ✗ | ✓ native |

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`packages/python`](packages/python) | 1.0.0 | Reference implementation — parser, compiler, graph API, storage |
| [`packages/mcp-server`](packages/mcp-server) | 1.0.0 | MCP server — use KNDL from Claude Desktop and any MCP client |
| [`website`](website) | — | Documentation site (React + Vite) |

## Quickstart

**Python library**

```bash
pip install kndl
```

```python
import kndl

graph = kndl.compile("""
node @alice :: Person {
  name = "Alice"
  role = "Engineer"
  ~confidence 0.95
  ~source "agent://hr"
}
edge @alice -[works_at]-> @acme { ~weight 1.0 }
""")

engineers = graph.query_nodes(type_name="Person", min_confidence=0.9)
print(kndl.serialize(graph))
```

**MCP server (Claude Desktop)**

```bash
pip install kndl-mcp
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kndl": { "command": "uvx", "args": ["kndl-mcp"] }
  }
}
```

Restart Claude Desktop, then ask: *"Remember that Alice is a senior engineer with confidence 0.95."*

## Features

- **Parameterised types** — `Observation<Code<"LOINC">>`, `Quantity<°C>`
- **Processes & state machines** — `process @sm :: StateMachine { ... }`
- **Uncertainty distributions** — `~uncertainty Gaussian { mean = X  stddev = Y }`
- **Multi-hop query patterns** — `-[T*]->`, `-[T*3]->`, `-[T*2..5]->`
- **Undirected typed edges** — `-[T]-` in addition to `->` and `<-`
- **Expanded meta-annotations** — `~recorded`, `~observed`, `~negated`, `~deadline`, `~classification`, `~retention`
- **Extended duration units** — `ns`, `us`, `mo`, `y`

## Repository layout

```
packages/
  python/        Python reference implementation (kndl)
  mcp-server/    MCP server (kndl-mcp)
website/         Documentation site
spec/            KNDL language specification (Markdown)
.github/         CI workflows
```

## Development

```bash
# Python library
cd packages/python
uv sync --all-extras
uv run pytest -v                    # 245 tests
uv run ruff check src tests
uv run mypy src

# MCP server
cd packages/mcp-server
uv sync --all-extras
uv run pytest tests/ -v             # 80 tests

# Website
cd website
pnpm install
pnpm dev
```

## License

MIT
