# kndl-mcp

MCP server that gives AI agents a persistent, confidence-aware knowledge graph.

Connect it to Claude Desktop and your agent can remember facts, build relationship graphs, and reason over structured knowledge — all through natural conversation.

**Version:** 1.0.0

## Quickstart with Claude Desktop

**1. Install**

```bash
pip install kndl-mcp
# or with uv (recommended):
uv add kndl-mcp
```

**2. Add to Claude Desktop config**

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kndl": {
      "command": "uvx",
      "args": ["kndl-mcp"]
    }
  }
}
```

Or, if running from source:

```json
{
  "mcpServers": {
    "kndl": {
      "command": "uv",
      "args": [
        "run", "--project", "/absolute/path/to/kndl/packages/mcp-server",
        "python", "-m", "kndl_mcp"
      ]
    }
  }
}
```

**3. Restart Claude Desktop** — you'll see a 🔌 icon when the server connects.

**Try it:** Ask Claude to *"Remember that Alice is a senior engineer on the payments team with confidence 0.95."* It will call `kndl_add_node` and the fact persists in the graph.

## Persistent storage

By default the graph is in-memory and resets on restart. To keep it across sessions, add a `.env` file next to where you run the server:

```bash
DATABASE_URL=sqlite:///./kndl.db          # local SQLite file
DATABASE_URL=postgresql://user:pw@host/db # PostgreSQL
```

## Run standalone

```bash
# stdio — for Claude Desktop
kndl-mcp
python -m kndl_mcp

# Streamable HTTP on port 8000 — for custom integrations
python -m kndl_mcp --http
```

## Tools

| Tool | Description |
|------|-------------|
| `kndl_add_node` | Add a typed node with fields, confidence, source, validity, decay, and extended meta (`recorded`, `observed`, `negated`, `deadline`, `classification`, `retention`, `uncertainty`) |
| `kndl_get_node` | Fetch a node with all its edges |
| `kndl_update_node` | Update fields or meta on an existing node |
| `kndl_remove_node` | Delete a node and all connected edges |
| `kndl_add_edge` | Add a typed edge between two nodes — `direction` controls `forward` / `reverse` / `undirected` |
| `kndl_query_nodes` | Filter nodes by type, confidence threshold, or field values |
| `kndl_neighborhood` | Get N-hop subgraph around a node (max 5 hops) |
| `kndl_add_intent` | Register a trigger-action reactive rule |
| `kndl_parse` | Parse a KNDL document (including `process` blocks) and merge it into the graph |
| `kndl_merge_graphs` | Merge a second KNDL document (higher confidence wins on conflict) |
| `kndl_serialize` | Export the full graph as KNDL text |
| `kndl_graph_stats` | Node / edge / intent / process counts and type distribution |
| `kndl_get_types` | List compiled type definitions in the graph |
| `kndl_reset` | Clear the entire graph |

## Resources

| URI | Description |
|-----|-------------|
| `kndl://spec/version` | Current KNDL spec version |
| `kndl://spec/grammar` | Full EBNF grammar |
| `kndl://spec/language` | Full language specification |
| `kndl://graph/types` | JSON snapshot of type declarations in the live graph |
| `kndl://graph/summary` | Live node / edge / intent / process count summary |

## Response format

All tools return `{"status": "ok", ...}` on success or `{"status": "error", "message": "..."}` on failure.

Node dicts use keys: `id`, `type`, `fields`, `meta`  
Edge dicts use keys: `id`, `source`, `target`, `type`, `direction`, `meta`  
Intent dicts use keys: `id`, `type`, `trigger` (`{kind, data}`), `actions`, `meta`  
Stats dict includes: `node_count`, `edge_count`, `intent_count`, `process_count`, `type_distribution`

## Development

```bash
uv sync --all-extras
uv run pytest tests/ -v   # 80 integration tests
uv run ruff check src tests
uv run mypy src
```

Tests call tool functions directly, bypassing the MCP transport layer. Each test class resets the global graph via `kndl_reset()` through an `autouse` fixture.

## License

MIT
