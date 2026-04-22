"""
KNDL AST — Abstract Syntax Tree definitions.

Defines the data structures produced by the parser.
These represent the semantic structure of a KNDL program.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# ── Base ──

@dataclass
class ASTNode:
    """Base class for all AST nodes."""
    line: int = 0
    col: int = 0


# ── Expressions ──

@dataclass
class Literal(ASTNode):
    """A literal value: int, float, decimal, string, bool, null, duration, datetime."""
    value: Any = None
    kind: str = "string"  # "int", "float", "decimal", "string", "bool", "null", "duration", "datetime"


@dataclass
class NodeRef(ASTNode):
    """A reference to a node: @name or @name.sub.path"""
    path: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return ".".join(self.path)

    @property
    def full_ref(self) -> str:
        return f"@{self.name}"


@dataclass
class VarBind(ASTNode):
    """A query variable binding: ?name"""
    name: str = ""


@dataclass
class FieldAccess(ASTNode):
    """Field access expression: expr.field"""
    target: Optional[ASTNode] = None
    field_name: str = ""


@dataclass
class IndexAccess(ASTNode):
    """Index access expression: expr[index]"""
    target: Optional[ASTNode] = None
    index: Optional[ASTNode] = None


@dataclass
class BinaryOp(ASTNode):
    """Binary operation: left op right"""
    left: Optional[ASTNode] = None
    op: str = ""
    right: Optional[ASTNode] = None


@dataclass
class UnaryOp(ASTNode):
    """Unary operation: op expr"""
    op: str = ""
    operand: Optional[ASTNode] = None


@dataclass
class FuncCall(ASTNode):
    """Function call: name(args)"""
    name: str = ""
    args: list[ASTNode] = field(default_factory=list)


@dataclass
class ArrayLiteral(ASTNode):
    """Array literal: [a, b, c]"""
    elements: list[ASTNode] = field(default_factory=list)


@dataclass
class MapLiteral(ASTNode):
    """Map literal: #{ k: v, ... } (v0.2) or { k: v, ... } (v0.1 compat)"""
    pairs: list[tuple[ASTNode, ASTNode]] = field(default_factory=list)


@dataclass
class RangeExpr(ASTNode):
    """Range expression: start .. end"""
    start: Optional[ASTNode] = None
    end: Optional[ASTNode] = None


@dataclass
class DecayExpr(ASTNode):
    """Decay rate expression: rate / duration"""
    rate: Optional[ASTNode] = None
    duration: Optional[ASTNode] = None


# ── Meta-Annotations ──

@dataclass
class MetaAnnotation(ASTNode):
    """A meta-annotation: ~key value"""
    key: str = ""
    value: Optional[ASTNode] = None  # Can be Literal, RangeExpr, DecayExpr, etc.


# ── Fields & Edges ──

@dataclass
class FieldAssignment(ASTNode):
    """Field assignment: name = value"""
    name: str = ""
    value: Optional[ASTNode] = None


@dataclass
class InlineEdge(ASTNode):
    """Inline edge within a node: field_name -> @target"""
    field_name: str = ""
    target: Optional[NodeRef] = None


# ── Top-Level Declarations ──

@dataclass
class NodeDecl(ASTNode):
    """Node declaration."""
    ref: Optional[NodeRef] = None
    type_name: str = ""
    fields: list[FieldAssignment] = field(default_factory=list)
    edges: list[InlineEdge] = field(default_factory=list)
    meta: list[MetaAnnotation] = field(default_factory=list)


@dataclass
class EdgeDecl(ASTNode):
    """Edge declaration."""
    source: Optional[NodeRef] = None
    targets: list[NodeRef] = field(default_factory=list)
    edge_type: str = "relates_to"
    direction: str = "forward"  # "forward", "bidirectional", "reverse"
    fields: list[FieldAssignment] = field(default_factory=list)
    meta: list[MetaAnnotation] = field(default_factory=list)


@dataclass
class FieldDecl(ASTNode):
    """Type field declaration: name : Type"""
    name: str = ""
    type_expr: Optional[TypeExpr] = None


@dataclass
class TypeExpr(ASTNode):
    """A type expression."""
    name: str = ""
    kind: str = "named"  # "named", "intersection", "union", "optional", "literal", "struct", "parameterised"
    children: list[TypeExpr] = field(default_factory=list)
    fields: list[FieldDecl] = field(default_factory=list)  # For struct types
    params: list[TypeExpr] = field(default_factory=list)   # For parameterised types: Name<P1, P2>


@dataclass
class ConstraintExpr(ASTNode):
    """A constraint in a where block."""
    expression: Optional[ASTNode] = None


@dataclass
class TypeDecl(ASTNode):
    """Type declaration."""
    name: str = ""
    type_expr: Optional[TypeExpr] = None
    fields: list[FieldDecl] = field(default_factory=list)
    constraints: list[ConstraintExpr] = field(default_factory=list)


@dataclass
class ContextDecl(ASTNode):
    """Context declaration."""
    ref: Optional[NodeRef] = None
    meta: list[MetaAnnotation] = field(default_factory=list)
    nodes: list[NodeDecl] = field(default_factory=list)
    edges: list[EdgeDecl] = field(default_factory=list)
    intents: list[IntentDecl] = field(default_factory=list)
    contexts: list[ContextDecl] = field(default_factory=list)


# ── Queries ──

@dataclass
class EdgePattern(ASTNode):
    """Edge pattern in a query: -[type]-> target"""
    edge_type: str = ""
    target: Optional[ASTNode] = None  # VarBind or NodeRef
    target_type: str = ""
    direction: str = "forward"
    hop_min: int = 1   # For multi-hop: -[T*2..5]->
    hop_max: int = 1   # -1 means unbounded (*)


@dataclass
class MatchClause(ASTNode):
    """Match clause in a query."""
    variable: Optional[VarBind] = None
    type_name: str = ""
    edge_pattern: Optional[EdgePattern] = None
    optional: bool = False


@dataclass
class AggField(ASTNode):
    """Aggregation field: name = func(expr)"""
    name: str = ""
    func: str = ""
    expr: Optional[ASTNode] = None


@dataclass
class ReturnClause(ASTNode):
    """Return clause in a query."""
    expression: Optional[ASTNode] = None
    with_edges: int = 0
    aggregations: list[AggField] = field(default_factory=list)


@dataclass
class QueryDecl(ASTNode):
    """Query declaration."""
    name: str = ""
    matches: list[MatchClause] = field(default_factory=list)
    where_expr: Optional[ASTNode] = None
    return_clause: Optional[ReturnClause] = None
    group_by: list[ASTNode] = field(default_factory=list)  # v0.2


# ── Intents ──

@dataclass
class TriggerClause(ASTNode):
    """Trigger clause in an intent."""
    kind: str = "expression"  # "expression", "query", "cron"
    expression: Optional[ASTNode] = None
    query: Optional[QueryDecl] = None
    cron_expr: str = ""


@dataclass
class EmitAction(ASTNode):
    """Emit action in an intent's do block."""
    node_decl: Optional[NodeDecl] = None
    action_type: str = "create"  # "create", "update", "delete", "goto"
    target_ref: Optional[NodeRef] = None
    goto_state: str = ""  # For action_type="goto" in process transitions


@dataclass
class IntentDecl(ASTNode):
    """Intent declaration."""
    ref: Optional[NodeRef] = None
    type_name: str = ""
    trigger: Optional[TriggerClause] = None
    actions: list[EmitAction] = field(default_factory=list)
    meta: list[MetaAnnotation] = field(default_factory=list)


# ── Process declarations (v0.2) ──

@dataclass
class StateDecl(ASTNode):
    """State declaration within a process."""
    name: str = ""
    meta: list[MetaAnnotation] = field(default_factory=list)


@dataclass
class TransitionDecl(ASTNode):
    """Transition declaration within a process."""
    event: str = ""
    from_state: str = ""
    to_state: str = ""
    where_expr: Optional[ASTNode] = None
    actions: list[EmitAction] = field(default_factory=list)
    compensate_actions: list[EmitAction] = field(default_factory=list)


@dataclass
class ProcessDecl(ASTNode):
    """Process declaration (v0.2)."""
    ref: Optional[NodeRef] = None
    type_name: str = ""
    states: list[StateDecl] = field(default_factory=list)
    transitions: list[TransitionDecl] = field(default_factory=list)
    meta: list[MetaAnnotation] = field(default_factory=list)


# ── Module System ──

@dataclass
class ImportDecl(ASTNode):
    """Import declaration."""
    names: list[str] = field(default_factory=list)
    source: str = ""


@dataclass
class ExportDecl(ASTNode):
    """Export declaration."""
    declaration: Optional[ASTNode] = None


# ── Program ──

@dataclass
class Program(ASTNode):
    """Root AST node: a complete KNDL program."""
    imports: list[ImportDecl] = field(default_factory=list)
    exports: list[ExportDecl] = field(default_factory=list)
    types: list[TypeDecl] = field(default_factory=list)
    nodes: list[NodeDecl] = field(default_factory=list)
    edges: list[EdgeDecl] = field(default_factory=list)
    contexts: list[ContextDecl] = field(default_factory=list)
    intents: list[IntentDecl] = field(default_factory=list)
    queries: list[QueryDecl] = field(default_factory=list)
    processes: list[ProcessDecl] = field(default_factory=list)  # v0.2
