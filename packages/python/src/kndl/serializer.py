"""
KNDL Serializer — Converts a KNDLGraph back to KNDL text format.

This enables round-tripping: parse KNDL → graph → KNDL text.
"""

from __future__ import annotations

from typing import Any

from .graph import KNDLGraph, GraphNode, GraphEdge, GraphIntent, KNDLMeta


def _format_value(val: Any) -> str:
    """Format a Python value as a KNDL literal."""
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        return str(val)
    if isinstance(val, str):
        if val.startswith("@"):
            return val
        return f'"{val}"'
    if isinstance(val, list):
        # Vector: homogeneous list of numbers
        if val and all(isinstance(v, (int, float)) for v in val):
            items = ", ".join(str(v) for v in val)
            return f"v[ {items} ]"
        items = ", ".join(_format_value(v) for v in val)
        return f"[ {items} ]"
    if isinstance(val, dict):
        if "currency" in val and "amount" in val:          # Money
            return f'{val["amount"]}d {val["currency"]}'
        if "unit" in val and "magnitude" in val:            # Quantity
            return f'{val["magnitude"]} {val["unit"]}'
        pairs = ", ".join(f'"{k}": {_format_value(v)}' for k, v in val.items())
        return f"#{{ {pairs} }}"
    return f'"{val}"'


def _seconds_to_duration(s: float) -> str:
    """Convert seconds to a KNDL duration string."""
    if s < 1:
        return f"{int(s * 1000)}ms"
    if s < 60:
        return f"{int(s)}s"
    if s < 3600:
        return f"{int(s / 60)}m"
    if s < 86400:
        return f"{int(s / 3600)}h"
    if s < 604800:
        return f"{int(s / 86400)}d"
    return f"{int(s / 604800)}w"


def _serialize_meta(meta: KNDLMeta, indent: str = "  ") -> list[str]:
    """Serialize meta-annotations to KNDL lines."""
    lines = []

    if meta.confidence != 1.0:
        lines.append(f"{indent}~confidence {meta.confidence}")
    if meta.source:
        lines.append(f'{indent}~source     "{meta.source}"')
    if meta.valid_start:
        end = meta.valid_end if meta.valid_end else "*"
        lines.append(f"{indent}~valid      {meta.valid_start} .. {end}")
    if meta.decay_rate is not None and meta.decay_duration_seconds is not None:
        dur = _seconds_to_duration(meta.decay_duration_seconds)
        lines.append(f"{indent}~decay      {meta.decay_rate} / {dur}")
    if meta.supersedes:
        lines.append(f"{indent}~supersedes {meta.supersedes}")
    if meta.derived_from:
        refs = ", ".join(meta.derived_from)
        lines.append(f"{indent}~derived    [ {refs} ]")
    if meta.access:
        lines.append(f'{indent}~access     "{meta.access}"')
    if meta.priority != 0.5:
        lines.append(f"{indent}~priority   {meta.priority}")
    if meta.cooldown_seconds:
        dur = _seconds_to_duration(meta.cooldown_seconds)
        lines.append(f"{indent}~cooldown   {dur}")
    if meta.tags:
        tags = ", ".join(f'"{t}"' for t in meta.tags)
        lines.append(f"{indent}~tags       [ {tags} ]")
    if meta.recorded:
        lines.append(f'{indent}~recorded   "{meta.recorded}"')
    if meta.observed:
        lines.append(f'{indent}~observed   "{meta.observed}"')
    if meta.negated:
        lines.append(f"{indent}~negated    true")
    if meta.deadline:
        lines.append(f'{indent}~deadline   "{meta.deadline}"')
    if meta.classification:
        lines.append(f'{indent}~classification "{meta.classification}"')
    if meta.uncertainty is not None:
        dist_type = meta.uncertainty.get("_type", "")
        if dist_type:
            params = {k: v for k, v in meta.uncertainty.items() if k != "_type"}
            pairs = ", ".join(f"{k} = {_format_value(v)}" for k, v in params.items())
            lines.append(f"{indent}~uncertainty {dist_type} {{ {pairs} }}")
        else:
            lines.append(f"{indent}~uncertainty {_format_value(meta.uncertainty)}")
    for k, v in meta.custom.items():
        lines.append(f"{indent}~{k}  {_format_value(v)}")

    return lines


class Serializer:
    """
    Serializes a KNDLGraph back to KNDL text format.

    Usage:
        serializer = Serializer()
        text = serializer.serialize(graph)
    """

    def serialize(self, graph: KNDLGraph) -> str:
        """Serialize the entire graph to KNDL text."""
        parts: list[str] = []

        # Nodes
        for node in graph.nodes.values():
            parts.append(self._serialize_node(node, graph))
            parts.append("")

        # Standalone edges (not inline)
        for edge in graph.edges.values():
            parts.append(self._serialize_edge(edge))
            parts.append("")

        # Intents
        for intent in graph.intents.values():
            parts.append(self._serialize_intent(intent))
            parts.append("")

        return "\n".join(parts).strip() + "\n"

    def _serialize_node(self, node: GraphNode, _graph: KNDLGraph) -> str:
        lines = [f"node @{node.id} :: {node.type_name} {{"]

        for k, v in node.fields.items():
            lines.append(f"  {k:<8} = {_format_value(v)}")

        # Edges are emitted as standalone declarations in serialize(), not inline,
        # to avoid duplication on roundtrip.

        lines.extend(_serialize_meta(node.meta))
        lines.append("}")
        return "\n".join(lines)

    def _serialize_edge(self, edge: GraphEdge) -> str:
        header = f"edge @{edge.source_id} -[{edge.edge_type}]-> @{edge.target_id}"

        if not edge.fields and not edge.meta.to_dict():
            return header

        lines = [f"{header} {{"]
        for k, v in edge.fields.items():
            lines.append(f"  {k:<8} = {_format_value(v)}")
        lines.extend(_serialize_meta(edge.meta))
        lines.append("}")
        return "\n".join(lines)

    def _serialize_intent(self, intent: GraphIntent) -> str:
        lines = [f"intent @{intent.id} :: {intent.type_name} {{"]

        if intent.trigger_kind == "cron":
            lines.append(f'  trigger = cron "{intent.trigger_data}"')
        elif intent.trigger_data:
            lines.append(f"  trigger = {intent.trigger_data}")

        if intent.actions:
            lines.append("  do {")
            for action in intent.actions:
                atype = action.get("type", "create")
                ntype = action.get("node_type", "Node")
                fields = action.get("fields", {})
                if atype == "create":
                    lines.append(f"    emit :: {ntype} {{")
                    for k, v in fields.items():
                        lines.append(f"      {k:<8} = {_format_value(v)}")
                    lines.append("    }")
                elif atype == "delete":
                    target = action.get("target", "")
                    lines.append(f"    emit delete {target}")
            lines.append("  }")

        lines.extend(_serialize_meta(intent.meta))
        lines.append("}")
        return "\n".join(lines)
