# kndl

Python library for **KNDL** — Knowledge Node Description Language.

Build, query, and persist confidence-aware knowledge graphs in Python. The reference implementation of the KNDL v0.2 spec.

[![PyPI](https://img.shields.io/pypi/v/kndl)](https://pypi.org/project/kndl/)
[![Python](https://img.shields.io/pypi/pyversions/kndl)](https://pypi.org/project/kndl/)

## Install

```bash
pip install kndl
# or with uv:
uv add kndl
```

## Quickstart

```python
import kndl

graph = kndl.compile("""
node @alice :: Person {
  name = "Alice"
  role = "Engineer"
  ~confidence 0.95
  ~source "agent://hr"
}

node @acme :: Company {
  name = "Acme Corp"
}

edge @alice -[works_at]-> @acme {
  ~confidence 1.0
}
""")

# Query by type and confidence
engineers = graph.query_nodes(type_name="Person", min_confidence=0.9)

# Get neighbours
subgraph = graph.query_neighborhood("alice", hops=2)

# Round-trip to KNDL text
print(kndl.serialize(graph))

# Export to JSON
import json
print(json.dumps(graph.to_dict(), indent=2))
```

## Persistent storage

Set `DATABASE_URL` in your environment or a `.env` file:

```bash
DATABASE_URL=sqlite:///./kndl.db          # local file, zero extra deps
DATABASE_URL=postgresql://user:pw@host/db # postgres (pip install 'kndl[postgres]')
```

```python
from kndl.storage import create_storage
from kndl.graph import KNDLGraph

storage = create_storage()   # reads DATABASE_URL from env / .env
graph = KNDLGraph.from_storage(storage) if storage else KNDLGraph()

# All mutations are now auto-persisted
graph.add_node(...)
graph.remove_node("alice")
```

## Confidence decay

Facts can lose confidence over time automatically:

```kndl
node @reading :: Sensor {
  value = 22.5
  ~confidence 0.99
  ~valid      2026-01-01T00:00Z .. *
  ~decay      0.95 / 1h   # drops 5% every hour
}
```

```python
node = graph.get_node("reading")
print(node.meta.effective_confidence())   # current confidence after decay
```

## v0.2 Features

### Parameterised types

Types accept type parameters, enabling domain-generic schemas that stay strongly typed at instantiation:

```kndl
type Observation<C> where C <: Code {
  code    : C
  value   : Float
  subject : Patient
}

node @obs_001 :: Observation<Code<"LOINC">> {
  code    = "8310-5"
  value   = 38.2
  subject -> @patient_p001
  ~confidence 0.96
}
```

### Processes and state machines

```kndl
process @grasp_sm :: StateMachine {
  states  = ["idle", "approaching", "grasping", "lifting"]
  initial = "idle"
  @idle        -> @approaching { trigger = "pickup_cmd" }
  @approaching -> @grasping   { trigger = @joint.angle > 30 }
}
```

### Uncertainty distributions

```kndl
node @temp :: Temperature<°C> {
  value = 22.5
  ~confidence  0.94
  ~uncertainty Gaussian { mean = 22.5  stddev = 0.3 }
}
```

Supported distributions: `Gaussian`, `Interval`, `Categorical`, `Histogram`.

### Multi-hop query patterns

```kndl
query supply_chain {
  match ?supplier -[supplies*2..4]-> ?product
  where ?supplier.~confidence > 0.8
  return { supplier: ?supplier, product: ?product }
}
```

### Undirected edges

```kndl
edge @room_204 -[adjacent_to]- @room_205
```

## API reference

### Top-level functions

| Function | Returns | Description |
|----------|---------|-------------|
| `kndl.compile(source)` | `KNDLGraph` | Parse and compile KNDL source to a graph |
| `kndl.parse(source)` | `Program` | Parse to AST only |
| `kndl.serialize(graph)` | `str` | Export graph as KNDL text |
| `kndl.tokenize(source)` | `list[Token]` | Tokenize source text |

### KNDLGraph

| Method | Description |
|--------|-------------|
| `add_node(node)` | Add a `GraphNode` |
| `get_node(node_id)` | Fetch a node or `None` |
| `update_node(node_id, fields, meta_updates)` | Partial update |
| `remove_node(node_id)` | Remove node and all its edges |
| `add_edge(edge)` | Add a `GraphEdge` |
| `remove_edge(edge_id)` | Remove an edge |
| `get_outgoing_edges(node_id, edge_type?)` | Edges leaving a node |
| `get_incoming_edges(node_id, edge_type?)` | Edges entering a node |
| `add_intent(intent)` | Register a reactive `GraphIntent` |
| `remove_intent(intent_id)` | Remove an intent |
| `query_nodes(type_name?, min_confidence?, field_filters?, apply_decay?)` | Filter nodes |
| `query_neighborhood(node_id, hops?)` | N-hop subgraph as dict |
| `to_dict()` | JSON-serialisable snapshot |
| `from_dict(data)` | Reconstruct from dict (classmethod) |
| `from_storage(storage)` | Warm graph from a storage backend (classmethod) |

### KNDLMeta fields

| Field | Type | Description |
|-------|------|-------------|
| `confidence` | `float` | Trust level 0.0–1.0 (default 1.0) |
| `source` | `str` | Provenance URI |
| `valid_start` / `valid_end` | `str \| None` | ISO datetime validity window |
| `decay_rate` / `decay_duration_seconds` | `float \| None` | Exponential decay parameters |
| `tags` | `list[str]` | Arbitrary labels |
| `priority` | `float` | For intent scheduling (default 0.5) |
| `cooldown_seconds` | `float \| None` | Minimum time between intent firings |
| `supersedes` | `str \| None` | ID of fact this replaces |
| `recorded` | `str \| None` | When this fact was recorded in the system |
| `observed` | `str \| None` | When the event was actually observed |
| `negated` | `bool` | Assert that this fact is false |
| `deadline` | `str \| None` | Time by which action must complete |
| `classification` | `str \| None` | Security classification label |
| `retention` | `str \| None` | How long to retain this record |
| `uncertainty` | `dict \| None` | Full probability distribution |

`meta.effective_confidence(at_time?)` applies decay and returns the current value.

## How it works

```
source text
  → Lexer      (lexer.py)       → list[Token]
  → Parser     (parser.py)      → Program (AST)
  → Compiler   (compiler.py)    → KNDLGraph
  → Serializer (serializer.py)  → KNDL text
```

## Development

```bash
uv sync --all-extras
uv run pytest -v                                        # 245 tests
uv run pytest --cov=src/kndl --cov-report=term-missing
uv run ruff check src tests
uv run mypy src
```

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `test_kndl.py` | 52 | Lexer, Parser, Compiler, Graph, Serializer |
| `test_kndl_extended.py` | 65 | Edge cases, integration, roundtrip |
| `test_storage.py` | 24 | SQLite, PostgreSQL, factory, persistence |
| `test_v02.py` | 72 | v0.2 syntax: processes, decimal, group-by, reverse edges |
| `test_v03_features.py` | 32 | Parameterised types, multi-hop, undirected edges, uncertainty, goto |

## License

MIT
