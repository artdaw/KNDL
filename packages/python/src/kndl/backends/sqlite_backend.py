"""SQLite storage backend for KNDLGraph — zero extra dependencies (stdlib sqlite3)."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from kndl.graph import GraphEdge, GraphIntent, GraphNode


_DDL = """
CREATE TABLE IF NOT EXISTS kndl_nodes (
    id        TEXT PRIMARY KEY,
    type_name TEXT NOT NULL,
    fields    TEXT NOT NULL DEFAULT '{}',
    meta      TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS kndl_edges (
    id        TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edge_type TEXT NOT NULL DEFAULT 'relates_to',
    direction TEXT NOT NULL DEFAULT 'forward',
    fields    TEXT NOT NULL DEFAULT '{}',
    meta      TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS kndl_intents (
    id           TEXT PRIMARY KEY,
    type_name    TEXT NOT NULL,
    trigger_kind TEXT NOT NULL DEFAULT 'expression',
    trigger_data TEXT NOT NULL DEFAULT '',
    actions      TEXT NOT NULL DEFAULT '[]',
    meta         TEXT NOT NULL DEFAULT '{}'
);
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_kndl_nodes_type   ON kndl_nodes (type_name)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_source ON kndl_edges (source_id)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_target ON kndl_edges (target_id)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_type   ON kndl_edges (edge_type)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_intents_type ON kndl_intents (type_name)",
]


def _path_from_url(url: str) -> str:
    """sqlite:///./kndl.db → ./kndl.db,  sqlite:///:memory: → :memory:"""
    m = re.match(r"sqlite:///(.+)", url)
    return m.group(1) if m else url


class SQLiteStorage:
    def __init__(self, url: str) -> None:
        path = _path_from_url(url)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        for stmt in _DDL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                self._conn.execute(stmt)
        for idx in _INDEXES:
            self._conn.execute(idx)
        self._conn.commit()

    # ── Load ──────────────────────────────────────────────────────────────────

    def load(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        cur = self._conn

        nodes = [
            {
                "id": r["id"],
                "type": r["type_name"],
                "fields": json.loads(r["fields"]),
                "meta": json.loads(r["meta"]),
            }
            for r in cur.execute(
                "SELECT id, type_name, fields, meta FROM kndl_nodes"
            )
        ]

        edges = [
            {
                "id": r["id"],
                "source": r["source_id"],
                "target": r["target_id"],
                "type": r["edge_type"],
                "direction": r["direction"],
                "fields": json.loads(r["fields"]),
                "meta": json.loads(r["meta"]),
            }
            for r in cur.execute(
                "SELECT id, source_id, target_id, edge_type, direction, fields, meta"
                " FROM kndl_edges"
            )
        ]

        intents = [
            {
                "id": r["id"],
                "type": r["type_name"],
                "trigger_kind": r["trigger_kind"],
                "trigger_data": r["trigger_data"],
                "actions": json.loads(r["actions"]),
                "meta": json.loads(r["meta"]),
            }
            for r in cur.execute(
                "SELECT id, type_name, trigger_kind, trigger_data, actions, meta"
                " FROM kndl_intents"
            )
        ]

        return nodes, edges, intents

    # ── Upsert / delete ───────────────────────────────────────────────────────

    def upsert_node(self, node: GraphNode) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO kndl_nodes (id, type_name, fields, meta)"
            " VALUES (?, ?, ?, ?)",
            (node.id, node.type_name,
             json.dumps(node.fields), json.dumps(node.meta.to_dict())),
        )
        self._conn.commit()

    def delete_node(self, node_id: str) -> None:
        self._conn.execute("DELETE FROM kndl_nodes WHERE id = ?", (node_id,))
        self._conn.commit()

    def upsert_edge(self, edge: GraphEdge) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO kndl_edges"
            " (id, source_id, target_id, edge_type, direction, fields, meta)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (edge.id, edge.source_id, edge.target_id, edge.edge_type, edge.direction,
             json.dumps(edge.fields), json.dumps(edge.meta.to_dict())),
        )
        self._conn.commit()

    def delete_edge(self, edge_id: str) -> None:
        self._conn.execute("DELETE FROM kndl_edges WHERE id = ?", (edge_id,))
        self._conn.commit()

    def upsert_intent(self, intent: GraphIntent) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO kndl_intents"
            " (id, type_name, trigger_kind, trigger_data, actions, meta)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (intent.id, intent.type_name, intent.trigger_kind, intent.trigger_data,
             json.dumps(intent.actions), json.dumps(intent.meta.to_dict())),
        )
        self._conn.commit()

    def delete_intent(self, intent_id: str) -> None:
        self._conn.execute("DELETE FROM kndl_intents WHERE id = ?", (intent_id,))
        self._conn.commit()

    def clear(self) -> None:
        self._conn.execute("DELETE FROM kndl_nodes")
        self._conn.execute("DELETE FROM kndl_edges")
        self._conn.execute("DELETE FROM kndl_intents")
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()