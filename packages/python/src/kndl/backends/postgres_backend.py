"""
PostgreSQL storage backend for KNDLGraph.

Requires:  pip install 'kndl[postgres]'  (psycopg2-binary)

Features:
  - JSONB columns for fields and meta — fast key-path queries, GIN-indexed
  - ON CONFLICT DO UPDATE (upsert) for all tables
  - Optional pgvector: add an `embedding VECTOR(1536)` column to kndl_nodes
    and query with cosine similarity if pgvector extension is installed
  - Automatic reconnect on connection drop (OperationalError)

Schema is created automatically on first connect.
"""

from __future__ import annotations

import json
from typing import Any

from kndl.graph import GraphEdge, GraphIntent, GraphNode

try:
    import psycopg2
    import psycopg2.extras
    import psycopg2.extensions
except ImportError as exc:
    raise ImportError(
        "PostgreSQL backend requires psycopg2.\n"
        "Install with:  pip install 'kndl[postgres]'\n"
        "  or:          pip install psycopg2-binary"
    ) from exc


_DDL = """
CREATE TABLE IF NOT EXISTS kndl_nodes (
    id        TEXT PRIMARY KEY,
    type_name TEXT NOT NULL,
    fields    JSONB NOT NULL DEFAULT '{}',
    meta      JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS kndl_edges (
    id        TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edge_type TEXT NOT NULL DEFAULT 'relates_to',
    direction TEXT NOT NULL DEFAULT 'forward',
    fields    JSONB NOT NULL DEFAULT '{}',
    meta      JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS kndl_intents (
    id           TEXT PRIMARY KEY,
    type_name    TEXT NOT NULL,
    trigger_kind TEXT NOT NULL DEFAULT 'expression',
    trigger_data TEXT NOT NULL DEFAULT '',
    actions      JSONB NOT NULL DEFAULT '[]',
    meta         JSONB NOT NULL DEFAULT '{}'
);
"""

# GIN indexes enable fast JSONB key/value lookups (e.g. meta @> '{"confidence": 0.9}')
_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_kndl_nodes_type   ON kndl_nodes (type_name)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_nodes_meta   ON kndl_nodes USING GIN (meta)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_nodes_fields ON kndl_nodes USING GIN (fields)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_source ON kndl_edges (source_id)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_target ON kndl_edges (target_id)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_edges_type   ON kndl_edges (edge_type)",
    "CREATE INDEX IF NOT EXISTS idx_kndl_intents_type ON kndl_intents (type_name)",
]


class PostgresStorage:
    def __init__(self, url: str) -> None:
        self._url = url
        self._conn = self._connect()
        self._setup()

    def _connect(self) -> psycopg2.extensions.connection:
        conn = psycopg2.connect(self._url, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn

    def _ensure_connection(self) -> None:
        """Reconnect automatically if the connection was dropped."""
        try:
            if self._conn.closed:
                self._conn = self._connect()
                return
            self._conn.cursor().execute("SELECT 1")
        except psycopg2.OperationalError:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = self._connect()

    def _setup(self) -> None:
        with self._conn.cursor() as cur:
            for stmt in _DDL.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
            for idx in _INDEXES:
                cur.execute(idx)
        self._conn.commit()

    # ── Load ──────────────────────────────────────────────────────────────────

    def load(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute("SELECT id, type_name, fields, meta FROM kndl_nodes")
            nodes = [
                {"id": r["id"], "type": r["type_name"],
                 "fields": r["fields"], "meta": r["meta"]}
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT id, source_id, target_id, edge_type, direction, fields, meta"
                " FROM kndl_edges"
            )
            edges = [
                {"id": r["id"], "source": r["source_id"], "target": r["target_id"],
                 "type": r["edge_type"], "direction": r["direction"],
                 "fields": r["fields"], "meta": r["meta"]}
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT id, type_name, trigger_kind, trigger_data, actions, meta"
                " FROM kndl_intents"
            )
            intents = [
                {"id": r["id"], "type": r["type_name"],
                 "trigger_kind": r["trigger_kind"], "trigger_data": r["trigger_data"],
                 "actions": r["actions"], "meta": r["meta"]}
                for r in cur.fetchall()
            ]

        return nodes, edges, intents

    # ── Upsert / delete ───────────────────────────────────────────────────────

    def upsert_node(self, node: GraphNode) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO kndl_nodes (id, type_name, fields, meta)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET type_name = EXCLUDED.type_name,
                      fields    = EXCLUDED.fields,
                      meta      = EXCLUDED.meta
                """,
                (node.id, node.type_name,
                 json.dumps(node.fields), json.dumps(node.meta.to_dict())),
            )
        self._conn.commit()

    def delete_node(self, node_id: str) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM kndl_nodes WHERE id = %s", (node_id,))
        self._conn.commit()

    def upsert_edge(self, edge: GraphEdge) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO kndl_edges
                  (id, source_id, target_id, edge_type, direction, fields, meta)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET source_id = EXCLUDED.source_id,
                      target_id = EXCLUDED.target_id,
                      edge_type = EXCLUDED.edge_type,
                      direction = EXCLUDED.direction,
                      fields    = EXCLUDED.fields,
                      meta      = EXCLUDED.meta
                """,
                (edge.id, edge.source_id, edge.target_id, edge.edge_type, edge.direction,
                 json.dumps(edge.fields), json.dumps(edge.meta.to_dict())),
            )
        self._conn.commit()

    def delete_edge(self, edge_id: str) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM kndl_edges WHERE id = %s", (edge_id,))
        self._conn.commit()

    def upsert_intent(self, intent: GraphIntent) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO kndl_intents
                  (id, type_name, trigger_kind, trigger_data, actions, meta)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET type_name    = EXCLUDED.type_name,
                      trigger_kind = EXCLUDED.trigger_kind,
                      trigger_data = EXCLUDED.trigger_data,
                      actions      = EXCLUDED.actions,
                      meta         = EXCLUDED.meta
                """,
                (intent.id, intent.type_name, intent.trigger_kind, intent.trigger_data,
                 json.dumps(intent.actions), json.dumps(intent.meta.to_dict())),
            )
        self._conn.commit()

    def delete_intent(self, intent_id: str) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM kndl_intents WHERE id = %s", (intent_id,))
        self._conn.commit()

    def clear(self) -> None:
        self._ensure_connection()
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM kndl_nodes")
            cur.execute("DELETE FROM kndl_edges")
            cur.execute("DELETE FROM kndl_intents")
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
