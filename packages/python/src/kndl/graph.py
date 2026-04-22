"""
KNDL Graph — In-memory knowledge graph with confidence-aware operations.

This is the runtime representation of a parsed KNDL program. It supports:
- Node and edge storage with meta-annotations
- Confidence decay computation
- Simple graph queries
- Serialization to/from dict (JSON-compatible)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from kndl.storage import KNDLStorage


@dataclass
class KNDLMeta:
    """Meta-annotations for a node or edge."""
    confidence: float = 1.0
    source: str = ""
    valid_start: Optional[str] = None
    valid_end: Optional[str] = None
    decay_rate: Optional[float] = None
    decay_duration_seconds: Optional[float] = None
    supersedes: Optional[str] = None
    derived_from: list[str] = field(default_factory=list)
    access: str = ""
    priority: float = 0.5
    cooldown_seconds: Optional[float] = None
    tags: list[str] = field(default_factory=list)
    custom: dict[str, Any] = field(default_factory=dict)
    # v0.2 fields
    recorded: Optional[str] = None
    observed: Optional[str] = None
    negated: bool = False
    deadline: Optional[str] = None
    classification: Optional[str] = None
    retention: Optional[str] = None
    uncertainty: Optional[dict[str, Any]] = None  # §9: gaussian/interval/categorical/histogram

    def effective_confidence(self, at_time: Optional[datetime] = None) -> float:
        """
        Compute effective confidence with decay applied.

        Formula: confidence × (decay_rate ^ (elapsed / decay_duration))
        """
        if self.decay_rate is None or self.decay_duration_seconds is None:
            return self.confidence

        if self.valid_start is None:
            return self.confidence

        now = at_time or datetime.now(timezone.utc)
        try:
            start = datetime.fromisoformat(self.valid_start.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return self.confidence

        elapsed = (now - start).total_seconds()
        if elapsed <= 0:
            return self.confidence

        # Narrow optional attributes to local floats for mypy
        decay_rate: float = float(self.decay_rate)  # safe: guarded by earlier None check
        decay_dur: float = float(self.decay_duration_seconds)  # safe: guarded above
        periods = elapsed / decay_dur
        return float(self.confidence * (decay_rate ** periods))

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.confidence != 1.0:
            d["confidence"] = self.confidence
        if self.source:
            d["source"] = self.source
        if self.valid_start:
            d["valid_start"] = self.valid_start
        if self.valid_end:
            d["valid_end"] = self.valid_end
        if self.decay_rate is not None:
            d["decay_rate"] = self.decay_rate
            d["decay_duration_seconds"] = self.decay_duration_seconds
        if self.supersedes:
            d["supersedes"] = self.supersedes
        if self.derived_from:
            d["derived_from"] = self.derived_from
        if self.access:
            d["access"] = self.access
        if self.priority != 0.5:
            d["priority"] = self.priority
        if self.cooldown_seconds:
            d["cooldown_seconds"] = self.cooldown_seconds
        if self.tags:
            d["tags"] = self.tags
        if self.custom:
            d["custom"] = self.custom
        # v0.2 fields
        if self.recorded:
            d["recorded"] = self.recorded
        if self.observed:
            d["observed"] = self.observed
        if self.negated:
            d["negated"] = self.negated
        if self.deadline:
            d["deadline"] = self.deadline
        if self.classification:
            d["classification"] = self.classification
        if self.retention:
            d["retention"] = self.retention
        if self.uncertainty is not None:
            d["uncertainty"] = self.uncertainty
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> KNDLMeta:
        return cls(
            confidence=d.get("confidence", 1.0),
            source=d.get("source", ""),
            valid_start=d.get("valid_start"),
            valid_end=d.get("valid_end"),
            decay_rate=d.get("decay_rate"),
            decay_duration_seconds=d.get("decay_duration_seconds"),
            supersedes=d.get("supersedes"),
            derived_from=d.get("derived_from", []),
            access=d.get("access", ""),
            priority=d.get("priority", 0.5),
            cooldown_seconds=d.get("cooldown_seconds"),
            tags=d.get("tags", []),
            custom=d.get("custom", {}),
            # v0.2 fields
            recorded=d.get("recorded"),
            observed=d.get("observed"),
            negated=d.get("negated", False),
            deadline=d.get("deadline"),
            classification=d.get("classification"),
            retention=d.get("retention"),
            uncertainty=d.get("uncertainty"),
        )


@dataclass
class GraphNode:
    """A node in the knowledge graph."""
    id: str = ""
    type_name: str = ""
    fields: dict[str, Any] = field(default_factory=dict)
    meta: KNDLMeta = field(default_factory=KNDLMeta)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "type": self.type_name,
            "fields": self.fields,
        }
        meta_d = self.meta.to_dict()
        if meta_d:
            d["meta"] = meta_d
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> GraphNode:
        return cls(
            id=d["id"],
            type_name=d.get("type", ""),
            fields=d.get("fields", {}),
            meta=KNDLMeta.from_dict(d.get("meta", {})),
        )


@dataclass
class GraphEdge:
    """An edge in the knowledge graph."""
    id: str = ""
    source_id: str = ""
    target_id: str = ""
    edge_type: str = "relates_to"
    direction: str = "forward"
    fields: dict[str, Any] = field(default_factory=dict)
    meta: KNDLMeta = field(default_factory=KNDLMeta)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "source": self.source_id,
            "target": self.target_id,
            "type": self.edge_type,
            "direction": self.direction,
        }
        if self.fields:
            d["fields"] = self.fields
        meta_d = self.meta.to_dict()
        if meta_d:
            d["meta"] = meta_d
        return d


@dataclass
class GraphIntent:
    """An intent (reactive rule) in the knowledge graph."""
    id: str = ""
    type_name: str = ""
    trigger_kind: str = "expression"
    trigger_data: str = ""
    actions: list[dict[str, Any]] = field(default_factory=list)
    meta: KNDLMeta = field(default_factory=KNDLMeta)
    last_fired: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "type": self.type_name,
            "trigger": {"kind": self.trigger_kind, "data": self.trigger_data},
            "actions": self.actions,
        }
        meta_d = self.meta.to_dict()
        if meta_d:
            d["meta"] = meta_d
        return d


class KNDLGraph:
    """
    In-memory knowledge graph.

    Supports CRUD operations, simple queries, confidence decay,
    and serialization.
    """

    def __init__(self, storage: "KNDLStorage | None" = None) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: dict[str, GraphEdge] = {}
        self.intents: dict[str, GraphIntent] = {}
        self.types: dict[str, dict[str, Any]] = {}
        self.processes: dict[str, Any] = {}  # v0.2
        self._edge_index_out: dict[str, list[str]] = {}  # node_id -> [edge_ids]
        self._edge_index_in: dict[str, list[str]] = {}
        self._storage: KNDLStorage | None = storage

    # ── Node operations ──

    def add_node(self, node: GraphNode) -> GraphNode:
        if not node.id:
            node.id = str(uuid.uuid4())
        self.nodes[node.id] = node
        if self._storage is not None:
            self._storage.upsert_node(node)
        return node

    def get_node(self, node_id: str) -> Optional[GraphNode]:
        return self.nodes.get(node_id)

    def remove_node(self, node_id: str) -> bool:
        if node_id not in self.nodes:
            return False
        del self.nodes[node_id]
        # Remove connected edges
        for eid in list(self._edge_index_out.get(node_id, [])):
            self.remove_edge(eid)
        for eid in list(self._edge_index_in.get(node_id, [])):
            self.remove_edge(eid)
        if self._storage is not None:
            self._storage.delete_node(node_id)
        return True

    def update_node(self, node_id: str, fields: Optional[dict[str, Any]] = None,
                    meta_updates: Optional[dict[str, Any]] = None) -> Optional[GraphNode]:
        node = self.nodes.get(node_id)
        if not node:
            return None
        if fields:
            node.fields.update(fields)
        if meta_updates:
            for k, v in meta_updates.items():
                if hasattr(node.meta, k):
                    setattr(node.meta, k, v)
        if self._storage is not None:
            self._storage.upsert_node(node)
        return node

    # ── Edge operations ──

    def add_edge(self, edge: GraphEdge) -> GraphEdge:
        if not edge.id:
            edge.id = str(uuid.uuid4())
        self.edges[edge.id] = edge
        self._edge_index_out.setdefault(edge.source_id, []).append(edge.id)
        self._edge_index_in.setdefault(edge.target_id, []).append(edge.id)
        if self._storage is not None:
            self._storage.upsert_edge(edge)
        return edge

    def get_edge(self, edge_id: str) -> Optional[GraphEdge]:
        return self.edges.get(edge_id)

    def remove_edge(self, edge_id: str) -> bool:
        edge = self.edges.pop(edge_id, None)
        if not edge:
            return False
        if edge.source_id in self._edge_index_out:
            self._edge_index_out[edge.source_id] = [
                e for e in self._edge_index_out[edge.source_id] if e != edge_id
            ]
        if edge.target_id in self._edge_index_in:
            self._edge_index_in[edge.target_id] = [
                e for e in self._edge_index_in[edge.target_id] if e != edge_id
            ]
        if self._storage is not None:
            self._storage.delete_edge(edge_id)
        return True

    def get_outgoing_edges(self, node_id: str, edge_type: Optional[str] = None) -> list[GraphEdge]:
        eids = self._edge_index_out.get(node_id, [])
        edges = [self.edges[eid] for eid in eids if eid in self.edges]
        if edge_type:
            edges = [e for e in edges if e.edge_type == edge_type]
        return edges

    def get_incoming_edges(self, node_id: str, edge_type: Optional[str] = None) -> list[GraphEdge]:
        eids = self._edge_index_in.get(node_id, [])
        edges = [self.edges[eid] for eid in eids if eid in self.edges]
        if edge_type:
            edges = [e for e in edges if e.edge_type == edge_type]
        return edges

    # ── Intent operations ──

    def add_intent(self, intent: GraphIntent) -> GraphIntent:
        if not intent.id:
            intent.id = str(uuid.uuid4())
        self.intents[intent.id] = intent
        if self._storage is not None:
            self._storage.upsert_intent(intent)
        return intent

    def remove_intent(self, intent_id: str) -> bool:
        if intent_id not in self.intents:
            return False
        del self.intents[intent_id]
        if self._storage is not None:
            self._storage.delete_intent(intent_id)
        return True

    # ── Query ──

    def query_nodes(
        self,
        type_name: Optional[str] = None,
        min_confidence: float = 0.0,
        field_filters: Optional[dict[str, Any]] = None,
        apply_decay: bool = True,
    ) -> list[GraphNode]:
        """
        Query nodes with optional type, confidence, and field filters.
        """
        results = []
        for node in self.nodes.values():
            if type_name and node.type_name != type_name:
                continue

            conf = node.meta.effective_confidence() if apply_decay else node.meta.confidence
            if conf < min_confidence:
                continue

            if field_filters:
                match = True
                for k, v in field_filters.items():
                    if k not in node.fields or node.fields[k] != v:
                        match = False
                        break
                if not match:
                    continue

            results.append(node)
        return results

    def query_neighborhood(self, node_id: str, hops: int = 1) -> dict[str, Any]:
        """Get the N-hop neighborhood around a node."""
        visited_nodes: set[str] = set()
        visited_edges: set[str] = set()
        frontier = {node_id}

        for _ in range(hops):
            next_frontier: set[str] = set()
            for nid in frontier:
                visited_nodes.add(nid)
                for edge in self.get_outgoing_edges(nid):
                    visited_edges.add(edge.id)
                    if edge.target_id not in visited_nodes:
                        next_frontier.add(edge.target_id)
                for edge in self.get_incoming_edges(nid):
                    visited_edges.add(edge.id)
                    if edge.source_id not in visited_nodes:
                        next_frontier.add(edge.source_id)
            frontier = next_frontier

        visited_nodes.update(frontier)

        return {
            "nodes": [self.nodes[nid].to_dict() for nid in visited_nodes if nid in self.nodes],
            "edges": [self.edges[eid].to_dict() for eid in visited_edges if eid in self.edges],
        }

    # ── Serialization ──

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges.values()],
            "intents": [i.to_dict() for i in self.intents.values()],
            "types": self.types,
            "summary": {
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "intent_count": len(self.intents),
                "type_count": len(self.types),
            },
        }
        if self.processes:
            d["processes"] = self.processes
        return d

    @classmethod
    def from_storage(cls, storage: "KNDLStorage") -> "KNDLGraph":
        """Create a graph pre-populated from an existing storage backend."""
        g = cls(storage=storage)
        nodes, edges, intents = storage.load()
        # Bypass storage writes during bulk load (data already persisted)
        g._storage = None
        for nd in nodes:
            g.add_node(GraphNode.from_dict(nd))
        for ed in edges:
            g.add_edge(GraphEdge(
                id=ed["id"],
                source_id=ed["source"],
                target_id=ed["target"],
                edge_type=ed.get("type", "relates_to"),
                direction=ed.get("direction", "forward"),
                fields=ed.get("fields", {}),
                meta=KNDLMeta.from_dict(ed.get("meta", {})),
            ))
        for it in intents:
            intent = GraphIntent(
                id=it["id"],
                type_name=it.get("type", ""),
                trigger_kind=it.get("trigger_kind", "expression"),
                trigger_data=it.get("trigger_data", ""),
                actions=it.get("actions", []),
                meta=KNDLMeta.from_dict(it.get("meta", {})),
            )
            g.intents[intent.id] = intent
        g._storage = storage  # re-attach after load
        return g

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "KNDLGraph":
        g = cls()
        for nd in d.get("nodes", []):
            g.add_node(GraphNode.from_dict(nd))
        for ed in d.get("edges", []):
            edge = GraphEdge(
                id=ed["id"],
                source_id=ed["source"],
                target_id=ed["target"],
                edge_type=ed.get("type", "relates_to"),
                direction=ed.get("direction", "forward"),
                fields=ed.get("fields", {}),
                meta=KNDLMeta.from_dict(ed.get("meta", {})),
            )
            g.add_edge(edge)
        g.types = d.get("types", {})
        g.processes = d.get("processes", {})
        return g
