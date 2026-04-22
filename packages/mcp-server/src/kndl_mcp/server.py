"""
KNDL MCP Server — Model Context Protocol server for KNDL knowledge graphs.

Exposes KNDL operations as MCP tools that AI agents can invoke.

Run:
  python -m kndl_mcp              # stdio transport (Claude Desktop)
  python -m kndl_mcp --http       # streamable HTTP (port 8000)
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

import kndl
from kndl.graph import KNDLGraph, GraphNode, GraphEdge, GraphIntent, KNDLMeta
from kndl.storage import create_storage

from ._meta import _duration_to_seconds

# Resolve spec files relative to this file's location inside the monorepo.
# server.py → kndl_mcp/ → src/ → mcp-server/ → packages/ → <repo-root>
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
_SPEC_GRAMMAR = _REPO_ROOT / "spec" / "grammar" / "kndl.ebnf"
_SPEC_FULL    = _REPO_ROOT / "spec" / "SPECIFICATION.md"


# ── Server setup ──────────────────────────────────────────────────────────────

mcp = FastMCP(
    "kndl-server",
    instructions="""KNDL Knowledge Graph Server.

Manages an in-memory KNDL (Knowledge Node Description Language) knowledge graph.

Use it to:
1. Parse KNDL source into a structured graph
2. Add/update/remove nodes and edges with confidence scores
3. Query nodes by type, confidence threshold, and field values
4. Explore node neighborhoods (N-hop traversals)
5. Serialize the graph back to KNDL text
6. Add intents (reactive trigger-action rules)

All nodes support meta-annotations: confidence (0.0–1.0), source URIs,
temporal validity ranges, and confidence decay rates.
""",
)

# Initialise storage once at import time (reads DATABASE_URL / .env).
# Returns None when DATABASE_URL is unset → pure in-memory mode.
_storage = create_storage()
_graph = KNDLGraph.from_storage(_storage) if _storage is not None else KNDLGraph()


def _get_graph() -> KNDLGraph:
    return _graph


def _reset_graph() -> None:
    global _graph
    if _storage is not None:
        _storage.clear()
        _graph = KNDLGraph(storage=_storage)
    else:
        _graph = KNDLGraph()


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
def kndl_parse(source: str) -> dict[str, Any]:
    """
    Parse KNDL source text and merge it into the knowledge graph.
    Returns the resulting graph as JSON.
    """
    try:
        new_graph = kndl.compile(source)
        g = _get_graph()
        for node in new_graph.nodes.values():
            g.add_node(node)
        for edge in new_graph.edges.values():
            g.add_edge(edge)
        for intent in new_graph.intents.values():
            g.add_intent(intent)
        g.types.update(new_graph.types)
        g.processes.update(new_graph.processes)
        return {"status": "ok", "graph": g.to_dict()}
    except (kndl.ParseError, kndl.LexerError) as e:
        return {"status": "error", "message": str(e)}


@mcp.tool()
def kndl_add_node(
    node_id: str,
    type_name: str,
    fields: dict[str, Any] | None = None,
    confidence: float = 1.0,
    source: str = "",
    valid_start: str | None = None,
    valid_end: str | None = None,
    decay_rate: float | None = None,
    decay_duration: str | None = None,
    tags: list[str] | None = None,
    # v0.2 meta fields
    recorded: str | None = None,
    observed: str | None = None,
    negated: bool = False,
    deadline: str | None = None,
    classification: str | None = None,
    retention: str | None = None,
    uncertainty: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Add a node to the knowledge graph.

    Args:
        node_id: Unique identifier (e.g. "sensor_t001")
        type_name: Node type (e.g. "Temperature")
        fields: Key-value data fields
        confidence: Certainty score 0.0–1.0
        source: URI of asserting entity (e.g. "agent://claude-sonnet-4.6")
        valid_start: Temporal validity start (ISO datetime)
        valid_end: Temporal validity end (ISO datetime or omit for open-ended)
        decay_rate: Confidence decay rate (e.g. 0.95)
        decay_duration: Duration per decay period (e.g. "1h", "30m", "1mo")
        tags: Free-form labels
        recorded: ISO datetime when fact was recorded (v0.2)
        observed: ISO datetime when fact was observed (v0.2)
        negated: Whether this fact is a negation (v0.2)
        deadline: ISO datetime deadline (v0.2)
        classification: Security classification label (v0.2)
        retention: Retention policy string (v0.2)
        uncertainty: Structured uncertainty model, e.g. {"_type": "gaussian", "mean": 0.5, "std": 0.1} (v0.2 §9)
    """
    meta = KNDLMeta(
        confidence=confidence,
        source=source,
        valid_start=valid_start,
        valid_end=valid_end,
        decay_rate=decay_rate,
        decay_duration_seconds=_duration_to_seconds(decay_duration) if decay_duration else None,
        tags=tags or [],
        recorded=recorded,
        observed=observed,
        negated=negated,
        deadline=deadline,
        classification=classification,
        retention=retention,
        uncertainty=uncertainty,
    )
    node = GraphNode(id=node_id, type_name=type_name, fields=fields or {}, meta=meta)
    _get_graph().add_node(node)
    return {"status": "ok", "node": node.to_dict()}


@mcp.tool()
def kndl_add_edge(
    source_id: str,
    target_id: str,
    edge_type: str = "relates_to",
    direction: str = "forward",
    confidence: float = 1.0,
    source_uri: str = "",
    fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Add an edge between two nodes.

    Args:
        source_id: ID of source node
        target_id: ID of target node
        edge_type: Semantic relationship (e.g. "located_in", "caused_by")
        direction: Edge direction — "forward" (-[T]->), "bidirectional" (<-[T]->),
                   "reverse" (<-[T]-), or "undirected" (-[T]-) (v0.2)
        confidence: Certainty 0.0–1.0
        source_uri: URI of asserting entity
        fields: Additional data on the edge
    """
    meta = KNDLMeta(confidence=confidence, source=source_uri)
    edge = GraphEdge(
        source_id=source_id,
        target_id=target_id,
        edge_type=edge_type,
        direction=direction,
        fields=fields or {},
        meta=meta,
    )
    _get_graph().add_edge(edge)
    return {"status": "ok", "edge": edge.to_dict()}


@mcp.tool()
def kndl_query_nodes(
    type_name: str | None = None,
    min_confidence: float = 0.0,
    field_filters: dict[str, Any] | None = None,
    apply_decay: bool = True,
) -> dict[str, Any]:
    """
    Query nodes by type, confidence, and field values.

    Args:
        type_name: Filter by node type (e.g. "Temperature")
        min_confidence: Minimum confidence threshold 0.0–1.0
        field_filters: Exact-match field filters (e.g. {"unit": "°C"})
        apply_decay: Apply confidence decay based on elapsed time
    """
    nodes = _get_graph().query_nodes(
        type_name=type_name,
        min_confidence=min_confidence,
        field_filters=field_filters,
        apply_decay=apply_decay,
    )
    return {"status": "ok", "count": len(nodes), "nodes": [n.to_dict() for n in nodes]}


@mcp.tool()
def kndl_get_node(node_id: str) -> dict[str, Any]:
    """
    Get a specific node and its connected edges.

    Args:
        node_id: The node's unique identifier
    """
    g = _get_graph()
    node = g.get_node(node_id)
    if not node:
        return {"status": "error", "message": f"Node '{node_id}' not found"}
    result = node.to_dict()
    result["outgoing_edges"] = [e.to_dict() for e in g.get_outgoing_edges(node_id)]
    result["incoming_edges"] = [e.to_dict() for e in g.get_incoming_edges(node_id)]
    result["effective_confidence"] = node.meta.effective_confidence()
    return {"status": "ok", "node": result}


@mcp.tool()
def kndl_update_node(
    node_id: str,
    fields: dict[str, Any] | None = None,
    confidence: float | None = None,
    source: str | None = None,
    valid_start: str | None = None,
    valid_end: str | None = None,
) -> dict[str, Any]:
    """
    Update an existing node's fields and meta-annotations.

    Args:
        node_id: ID of node to update
        fields: Fields to merge (partial update)
        confidence: New confidence score
        source: New source URI
        valid_start: New validity start
        valid_end: New validity end
    """
    meta_updates: dict[str, Any] = {}
    if confidence is not None:
        meta_updates["confidence"] = confidence
    if source is not None:
        meta_updates["source"] = source
    if valid_start is not None:
        meta_updates["valid_start"] = valid_start
    if valid_end is not None:
        meta_updates["valid_end"] = valid_end

    node = _get_graph().update_node(node_id, fields=fields, meta_updates=meta_updates or None)
    if not node:
        return {"status": "error", "message": f"Node '{node_id}' not found"}
    return {"status": "ok", "node": node.to_dict()}


@mcp.tool()
def kndl_remove_node(node_id: str) -> dict[str, Any]:
    """Remove a node and all its connected edges from the graph."""
    if _get_graph().remove_node(node_id):
        return {"status": "ok", "message": f"Node '{node_id}' removed"}
    return {"status": "error", "message": f"Node '{node_id}' not found"}


@mcp.tool()
def kndl_neighborhood(node_id: str, hops: int = 1) -> dict[str, Any]:
    """
    Get the N-hop neighborhood around a node.

    Args:
        node_id: Center node ID
        hops: Number of hops to traverse (1–5)
    """
    g = _get_graph()
    if not g.get_node(node_id):
        return {"status": "error", "message": f"Node '{node_id}' not found"}
    return {"status": "ok", **g.query_neighborhood(node_id, hops=max(1, min(hops, 5)))}


@mcp.tool()
def kndl_serialize() -> dict[str, Any]:
    """Serialize the current knowledge graph to KNDL text format."""
    g = _get_graph()
    return {
        "status": "ok",
        "kndl_text": kndl.serialize(g),
        "stats": {
            "node_count": len(g.nodes),
            "edge_count": len(g.edges),
            "intent_count": len(g.intents),
            "type_count": len(g.types),
            "process_count": len(g.processes),
        },
    }


@mcp.tool()
def kndl_graph_stats() -> dict[str, Any]:
    """Get summary statistics about the current knowledge graph."""
    g = _get_graph()
    type_counts: dict[str, int] = {}
    confidences: list[float] = []
    for node in g.nodes.values():
        type_counts[node.type_name] = type_counts.get(node.type_name, 0) + 1
        confidences.append(node.meta.effective_confidence())
    avg = sum(confidences) / len(confidences) if confidences else 0.0
    return {
        "status": "ok",
        "stats": {
            "node_count": len(g.nodes),
            "edge_count": len(g.edges),
            "intent_count": len(g.intents),
            "type_count": len(g.types),
            "process_count": len(g.processes),
            "type_distribution": type_counts,
            "average_confidence": round(avg, 4),
        },
    }


@mcp.tool()
def kndl_add_intent(
    intent_id: str,
    type_name: str = "Action",
    trigger_kind: str = "expression",
    trigger_data: str = "",
    actions: list[dict[str, Any]] | None = None,
    priority: float = 0.5,
    cooldown: str | None = None,
) -> dict[str, Any]:
    """
    Add a reactive intent (trigger-action rule) to the graph.

    Args:
        intent_id: Unique identifier
        type_name: Intent type (e.g. "Action", "ScheduledAction")
        trigger_kind: "expression", "query", or "cron"
        trigger_data: Trigger expression, query name, or cron string
        actions: List of action dicts with keys: type, node_type, fields
        priority: Execution priority 0.0–1.0
        cooldown: Cooldown duration (e.g. "15m", "1h")
    """
    meta = KNDLMeta(
        priority=priority,
        cooldown_seconds=_duration_to_seconds(cooldown) if cooldown else None,
    )
    intent = GraphIntent(
        id=intent_id,
        type_name=type_name,
        trigger_kind=trigger_kind,
        trigger_data=trigger_data,
        actions=actions or [],
        meta=meta,
    )
    _get_graph().add_intent(intent)
    return {"status": "ok", "intent": intent.to_dict()}


@mcp.tool()
def kndl_merge_graphs(source: str) -> dict[str, Any]:
    """
    Parse KNDL source text and merge it into the existing graph.
    For existing nodes: merges fields and takes higher confidence.

    Args:
        source: KNDL source text to parse and merge
    """
    try:
        new_graph = kndl.compile(source)
        g = _get_graph()
        merged = new_nodes = new_edges = 0

        for node in new_graph.nodes.values():
            existing = g.get_node(node.id)
            if existing:
                existing.fields.update(node.fields)
                if node.meta.confidence > existing.meta.confidence:
                    existing.meta.confidence = node.meta.confidence
                if node.meta.source:
                    existing.meta.source = node.meta.source
                existing.meta.derived_from.extend(node.meta.derived_from)
                merged += 1
            else:
                g.add_node(node)
                new_nodes += 1

        for edge in new_graph.edges.values():
            g.add_edge(edge)
            new_edges += 1

        for intent in new_graph.intents.values():
            g.add_intent(intent)
        g.types.update(new_graph.types)
        g.processes.update(new_graph.processes)

        return {
            "status": "ok",
            "merged_nodes": merged,
            "new_nodes": new_nodes,
            "new_edges": new_edges,
            "total_nodes": len(g.nodes),
            "total_edges": len(g.edges),
        }
    except (kndl.ParseError, kndl.LexerError) as e:
        return {"status": "error", "message": str(e)}


@mcp.tool()
def kndl_get_types(type_name: str | None = None) -> dict[str, Any]:
    """
    Return the compiled type schema declared in the current graph.

    Args:
        type_name: If provided, return only that type definition.
                   If omitted, return all declared types.

    Each type entry contains:
      - name:        type identifier
      - fields:      mapping of field name → declared type (e.g. {"value": "Float"})
      - constraints: list of where-clause constraint strings (may be empty)
    """
    types = _get_graph().types
    if type_name is not None:
        if type_name not in types:
            return {"status": "error", "message": f"Type '{type_name}' not found"}
        return {"status": "ok", "type": types[type_name]}
    return {"status": "ok", "count": len(types), "types": types}


@mcp.tool()
def kndl_reset() -> dict[str, Any]:
    """Reset the knowledge graph to an empty state. Deletes all data."""
    _reset_graph()
    return {"status": "ok", "message": "Graph reset to empty state"}


# ── Resources ─────────────────────────────────────────────────────────────────

@mcp.resource("kndl://spec/version")
def spec_version() -> str:
    return f"KNDL Specification v{kndl.__version__}"


@mcp.resource("kndl://spec/grammar")
def spec_grammar() -> str:
    """Full EBNF grammar for the KNDL language."""
    if _SPEC_GRAMMAR.exists():
        return _SPEC_GRAMMAR.read_text(encoding="utf-8")
    return "# EBNF grammar file not found (expected at spec/grammar/kndl.ebnf)"


@mcp.resource("kndl://spec/language")
def spec_language() -> str:
    """Full KNDL language specification (Markdown)."""
    if _SPEC_FULL.exists():
        return _SPEC_FULL.read_text(encoding="utf-8")
    return "# Specification file not found (expected at spec/SPECIFICATION.md)"


@mcp.resource("kndl://graph/types")
def graph_types() -> str:
    """Type schema declared in the current graph (JSON)."""
    import json
    g = _get_graph()
    return json.dumps(
        {"count": len(g.types), "types": g.types},
        indent=2,
    )


@mcp.resource("kndl://graph/summary")
def graph_summary() -> str:
    g = _get_graph()
    type_counts: dict[str, int] = {}
    for n in g.nodes.values():
        type_counts[n.type_name] = type_counts.get(n.type_name, 0) + 1
    lines = [
        "KNDL Knowledge Graph Summary",
        f"  Nodes:   {len(g.nodes)}",
        f"  Edges:   {len(g.edges)}",
        f"  Intents: {len(g.intents)}",
        f"  Types:   {len(g.types)}",
    ]
    if type_counts:
        lines.append("\nNode types:")
        for t, c in sorted(type_counts.items()):
            lines.append(f"  {t}: {c}")
    return "\n".join(lines)


# ── Prompts ───────────────────────────────────────────────────────────────────

@mcp.prompt()
def create_knowledge_node(
    topic: str,
    confidence: str = "0.8",
    source: str = "agent://claude",
) -> str:
    return f"""Create a KNDL node to represent knowledge about: {topic}

Use this format:
node @<id> :: <Type> {{
  <field> = <value>
  ~confidence {confidence}
  ~source     "{source}"
  ~valid      <datetime> .. *
}}

Make the node ID descriptive, choose an appropriate type, include
relevant fields, and set confidence based on how certain the information is."""


@mcp.prompt()
def analyze_graph() -> str:
    return """Analyze the current KNDL knowledge graph:

1. Use kndl_graph_stats to get an overview
2. Use kndl_query_nodes to find nodes with low confidence
3. Identify nodes that might need updating (check valid dates)
4. Look for disconnected nodes that should have edges
5. Suggest intents that could automate actions based on graph state

Provide a structured analysis with recommendations."""


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    transport = "streamable-http" if "--http" in sys.argv else "stdio"
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()
