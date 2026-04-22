"""
KNDL Compiler — Transforms a parsed AST into a runtime KNDLGraph.

Implements KNDL Specification v0.2.0, Section 4 (Core Constructs).
Walks the Program AST produced by the Parser and populates a KNDLGraph
with GraphNode, GraphEdge, and GraphIntent objects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .ast_nodes import (
    ASTNode, Program, NodeDecl, EdgeDecl, TypeDecl, ContextDecl, IntentDecl,
    MetaAnnotation, ProcessDecl,
    Literal, NodeRef, ArrayLiteral, MapLiteral, RangeExpr, DecayExpr,
    BinaryOp, UnaryOp, FuncCall, FieldAccess, VarBind,
)
from .graph import KNDLGraph, GraphNode, GraphEdge, GraphIntent, KNDLMeta


# ── Duration parsing ──────────────────────────────────────────────────────────

_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)(ns|us|mo|ms|s|m|h|d|w|y)$")
_DURATION_MULT: dict[str, float] = {
    "ns": 1e-9, "us": 1e-6, "ms": 0.001,
    "s": 1.0, "m": 60.0, "h": 3600.0, "d": 86400.0, "w": 604800.0,
    "mo": 2592000.0, "y": 31536000.0,
}


def _duration_to_seconds(duration_str: str) -> float | None:
    """Convert a KNDL duration literal (e.g. '1h', '30m') to seconds."""
    m = _DURATION_RE.match(str(duration_str).strip())
    if not m:
        return None
    return float(m.group(1)) * _DURATION_MULT[m.group(2)]


# ── Value evaluation ──────────────────────────────────────────────────────────

def _eval_value(node: ASTNode | None) -> Any:
    """Evaluate an AST expression to a plain Python value."""
    if node is None:
        return None

    if isinstance(node, Literal):
        return node.value

    if isinstance(node, NodeRef):
        return node.full_ref

    if isinstance(node, ArrayLiteral):
        return [_eval_value(e) for e in node.elements]

    if isinstance(node, MapLiteral):
        return {_eval_value(k): _eval_value(v) for k, v in node.pairs}

    if isinstance(node, VarBind):
        return f"?{node.name}"

    if isinstance(node, FieldAccess):
        target = _eval_value(node.target)
        return f"{target}.{node.field_name}"

    if isinstance(node, FuncCall):
        args = [_eval_value(a) for a in node.args]
        return f"{node.name}({', '.join(str(a) for a in args)})"

    if isinstance(node, BinaryOp):
        left = _eval_value(node.left)
        right = _eval_value(node.right)
        return f"{left} {node.op} {right}"

    if isinstance(node, UnaryOp):
        operand = _eval_value(node.operand)
        return f"{node.op} {operand}"

    if isinstance(node, RangeExpr):
        start = _eval_value(node.start)
        end = _eval_value(node.end)
        return f"{start} .. {end}"

    if isinstance(node, DecayExpr):
        rate = _eval_value(node.rate)
        duration = _eval_value(node.duration)
        return f"{rate} / {duration}"

    return str(node)


# ── Inherited meta context ────────────────────────────────────────────────────

@dataclass
class _MetaContext:
    """Inherited meta-annotation defaults from parent context."""
    confidence: float = 1.0
    source: str = ""
    access: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def override(self, annotations: list[MetaAnnotation]) -> _MetaContext:
        """Return a new context with these annotations merged in."""
        ctx = _MetaContext(
            confidence=self.confidence,
            source=self.source,
            access=self.access,
            extra=dict(self.extra),
        )
        for ann in annotations:
            match ann.key:
                case "confidence":
                    ctx.confidence = float(_eval_value(ann.value) or ctx.confidence)
                case "source":
                    ctx.source = str(_eval_value(ann.value) or ctx.source)
                case "access":
                    ctx.access = str(_eval_value(ann.value) or ctx.access)
                case _:
                    ctx.extra[ann.key] = _eval_value(ann.value)
        return ctx


# ── Meta extraction ───────────────────────────────────────────────────────────

def _build_meta(annotations: list[MetaAnnotation], ctx: _MetaContext) -> KNDLMeta:
    """Convert AST meta-annotations + inherited context into a KNDLMeta."""
    meta = KNDLMeta(
        confidence=ctx.confidence,
        source=ctx.source,
        access=ctx.access,
    )

    # Apply inherited custom keys
    for k, v in ctx.extra.items():
        meta.custom[k] = v

    for ann in annotations:
        key = ann.key
        val_node = ann.value

        match key:
            case "confidence":
                raw = _eval_value(val_node)
                meta.confidence = float(raw) if raw is not None else meta.confidence

            case "source":
                raw = _eval_value(val_node)
                meta.source = str(raw) if raw is not None else meta.source

            case "access":
                raw = _eval_value(val_node)
                meta.access = str(raw) if raw is not None else meta.access

            case "valid":
                if isinstance(val_node, RangeExpr):
                    start = _eval_value(val_node.start)
                    end = _eval_value(val_node.end)
                    meta.valid_start = str(start) if start not in (None, "null") else None
                    meta.valid_end = str(end) if end not in ("*", None, "null") else None
                else:
                    meta.valid_start = str(_eval_value(val_node))

            case "decay":
                if isinstance(val_node, DecayExpr):
                    rate = _eval_value(val_node.rate)
                    dur = _eval_value(val_node.duration)
                    meta.decay_rate = float(rate) if rate is not None else None
                    meta.decay_duration_seconds = (
                        _duration_to_seconds(str(dur)) if dur is not None else None
                    )
                elif isinstance(val_node, BinaryOp) and val_node.op == "/":
                    # Parser may consume `0.95 / 1h` as BinaryOp division
                    rate = _eval_value(val_node.left)
                    dur = _eval_value(val_node.right)
                    meta.decay_rate = float(rate) if rate is not None else None
                    meta.decay_duration_seconds = (
                        _duration_to_seconds(str(dur)) if dur is not None else None
                    )

            case "supersedes":
                raw = _eval_value(val_node)
                meta.supersedes = str(raw) if raw else None

            case "derived":
                raw = _eval_value(val_node)
                if isinstance(raw, list):
                    meta.derived_from = [str(r) for r in raw]
                elif raw:
                    meta.derived_from = [str(raw)]

            case "priority":
                raw = _eval_value(val_node)
                meta.priority = float(raw) if raw is not None else meta.priority

            case "cooldown":
                raw = _eval_value(val_node)
                if raw is not None:
                    meta.cooldown_seconds = _duration_to_seconds(str(raw))

            case "tags":
                raw = _eval_value(val_node)
                if isinstance(raw, list):
                    meta.tags = [str(t) for t in raw]

            case "weight":
                raw = _eval_value(val_node)
                meta.custom["weight"] = float(raw) if raw is not None else None

            # v0.2 meta fields
            case "recorded":
                raw = _eval_value(val_node)
                meta.recorded = str(raw) if raw is not None else None

            case "observed":
                raw = _eval_value(val_node)
                meta.observed = str(raw) if raw is not None else None

            case "negated":
                raw = _eval_value(val_node)
                meta.negated = bool(raw) if raw is not None else False

            case "deadline":
                raw = _eval_value(val_node)
                meta.deadline = str(raw) if raw is not None else None

            case "classification":
                raw = _eval_value(val_node)
                meta.classification = str(raw) if raw is not None else None

            case "retention":
                raw = _eval_value(val_node)
                meta.retention = str(raw) if raw is not None else None

            case "uncertainty":
                raw = _eval_value(val_node)
                meta.uncertainty = dict(raw) if isinstance(raw, dict) else {"value": raw}

            case _:
                meta.custom[key] = _eval_value(val_node)

    return meta


# ── Compiler ──────────────────────────────────────────────────────────────────

class Compiler:
    """
    Compiles a KNDL Program AST into a KNDLGraph.

    Usage:
        compiler = Compiler()
        graph = compiler.compile(program)
    """

    def compile(self, program: Program) -> KNDLGraph:
        graph = KNDLGraph()
        ctx = _MetaContext()
        self._compile_program(program, graph, ctx)
        return graph

    # ── Program ──

    def _compile_program(self, program: Program, graph: KNDLGraph, ctx: _MetaContext) -> None:
        for type_decl in program.types:
            self._compile_type_decl(type_decl, graph)
        for node_decl in program.nodes:
            self._compile_node_decl(node_decl, graph, ctx)
        for edge_decl in program.edges:
            self._compile_edge_decl(edge_decl, graph, ctx)
        for context_decl in program.contexts:
            self._compile_context_decl(context_decl, graph, ctx)
        for intent_decl in program.intents:
            self._compile_intent_decl(intent_decl, graph, ctx)
        for process_decl in program.processes:
            self._compile_process_decl(process_decl, graph, ctx)

    # ── Types ──

    def _compile_type_decl(self, decl: TypeDecl, graph: KNDLGraph) -> None:
        graph.types[decl.name] = {
            "name": decl.name,
            "fields": {f.name: f.type_expr.name if f.type_expr else "Any" for f in decl.fields},
            "constraints": [str(c.expression) for c in decl.constraints] if decl.constraints else [],
        }

    # ── Nodes ──

    def _compile_node_decl(
        self, decl: NodeDecl, graph: KNDLGraph, ctx: _MetaContext
    ) -> GraphNode:
        node_id = decl.ref.name if decl.ref else ""
        fields: dict[str, Any] = {}
        inline_edges: list[tuple[str, str]] = []

        for member in decl.fields:
            fields[member.name] = _eval_value(member.value)

        for ie in decl.edges:
            # `ie.target` may be optional; skip if missing to satisfy type checker
            if ie.target is not None:
                inline_edges.append((ie.field_name, ie.target.name))

        meta = _build_meta(decl.meta, ctx)
        node = GraphNode(id=node_id, type_name=decl.type_name, fields=fields, meta=meta)
        graph.add_node(node)

        # Inline edges become GraphEdge objects
        for edge_field, target_id in inline_edges:
            edge = GraphEdge(
                source_id=node_id,
                target_id=target_id,
                edge_type=edge_field,
                meta=KNDLMeta(confidence=meta.confidence, source=meta.source),
            )
            graph.add_edge(edge)

        return node

    # ── Edges ──

    def _compile_edge_decl(
        self, decl: EdgeDecl, graph: KNDLGraph, ctx: _MetaContext
    ) -> list[GraphEdge]:
        source_id = decl.source.name if decl.source else ""
        meta = _build_meta(decl.meta, ctx)
        fields: dict[str, Any] = {f.name: _eval_value(f.value) for f in decl.fields}
        created: list[GraphEdge] = []

        for target_ref in decl.targets:
            edge = GraphEdge(
                source_id=source_id,
                target_id=target_ref.name,
                edge_type=decl.edge_type,
                direction=decl.direction,
                fields=dict(fields),
                meta=meta,
            )
            graph.add_edge(edge)
            created.append(edge)

            # Bidirectional → also add reverse edge
            if decl.direction == "bidirectional":
                rev = GraphEdge(
                    source_id=target_ref.name,
                    target_id=source_id,
                    edge_type=decl.edge_type,
                    direction="bidirectional",
                    fields=dict(fields),
                    meta=meta,
                )
                graph.add_edge(rev)
                created.append(rev)

        return created

    # ── Contexts ──

    def _compile_context_decl(
        self, decl: ContextDecl, graph: KNDLGraph, parent_ctx: _MetaContext
    ) -> None:
        # Context meta-annotations are inherited by all child nodes
        child_ctx = parent_ctx.override(decl.meta)

        for type_decl in getattr(decl, "types", []):
            self._compile_type_decl(type_decl, graph)
        for node_decl in decl.nodes:
            self._compile_node_decl(node_decl, graph, child_ctx)
        for edge_decl in decl.edges:
            self._compile_edge_decl(edge_decl, graph, child_ctx)
        for intent_decl in decl.intents:
            self._compile_intent_decl(intent_decl, graph, child_ctx)
        for nested_ctx in decl.contexts:
            self._compile_context_decl(nested_ctx, graph, child_ctx)

    # ── Intents ──

    def _compile_intent_decl(
        self, decl: IntentDecl, graph: KNDLGraph, ctx: _MetaContext
    ) -> GraphIntent:
        intent_id = decl.ref.name if decl.ref else ""
        meta = _build_meta(decl.meta, ctx)

        trigger_kind = "expression"
        trigger_data = ""
        if decl.trigger:
            trigger_kind = decl.trigger.kind
            if decl.trigger.kind == "cron":
                trigger_data = decl.trigger.cron_expr
            elif decl.trigger.kind == "query" and decl.trigger.query:
                trigger_data = decl.trigger.query.name or "inline_query"
            elif decl.trigger.expression:
                trigger_data = str(_eval_value(decl.trigger.expression))

        actions: list[dict[str, Any]] = []
        for action in decl.actions:
            if action.action_type == "create" and action.node_decl:
                nd = action.node_decl
                actions.append({
                    "type": "create",
                    "node_type": nd.type_name,
                    "fields": {f.name: _eval_value(f.value) for f in nd.fields},
                })
            elif action.action_type == "delete" and action.target_ref:
                actions.append({
                    "type": "delete",
                    "target": action.target_ref.full_ref,
                })
            elif action.action_type == "update" and action.node_decl:
                nd = action.node_decl
                actions.append({
                    "type": "update",
                    "target": nd.ref.full_ref if nd.ref else "",
                    "fields": {f.name: _eval_value(f.value) for f in nd.fields},
                })

        intent = GraphIntent(
            id=intent_id,
            type_name=decl.type_name,
            trigger_kind=trigger_kind,
            trigger_data=trigger_data,
            actions=actions,
            meta=meta,
        )
        graph.add_intent(intent)
        return intent

    # ── Processes (v0.2) ──

    def _compile_process_decl(
        self, decl: ProcessDecl, graph: KNDLGraph, ctx: _MetaContext
    ) -> None:
        process_id = decl.ref.name if decl.ref else ""
        meta = _build_meta(decl.meta, ctx)

        states = []
        for sd in decl.states:
            state_meta = _build_meta(sd.meta, ctx)
            states.append({
                "name": sd.name,
                "meta": state_meta.to_dict(),
            })

        transitions = []
        for td in decl.transitions:
            t_entry: dict[str, Any] = {
                "event": td.event,
                "from": td.from_state,
                "to": td.to_state,
            }
            if td.where_expr is not None:
                t_entry["where"] = str(_eval_value(td.where_expr))
            if td.actions:
                t_entry["actions"] = [
                    {
                        "type": a.action_type,
                        "node_type": a.node_decl.type_name if a.node_decl else "",
                        "fields": {f.name: _eval_value(f.value) for f in a.node_decl.fields} if a.node_decl else {},
                    }
                    for a in td.actions
                ]
            if td.compensate_actions:
                t_entry["compensate"] = [
                    {
                        "type": a.action_type,
                        "node_type": a.node_decl.type_name if a.node_decl else "",
                        "fields": {f.name: _eval_value(f.value) for f in a.node_decl.fields} if a.node_decl else {},
                    }
                    for a in td.compensate_actions
                ]
            transitions.append(t_entry)

        graph.processes[process_id] = {
            "id": process_id,
            "type": decl.type_name,
            "states": states,
            "transitions": transitions,
            "meta": meta.to_dict(),
        }
