"""
Storage backend tests — SQLite in-memory CRUD, persistence roundtrip,
create_storage() factory, and KNDLGraph.from_storage() / remove_intent().
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest

from kndl.graph import GraphEdge, GraphIntent, GraphNode, KNDLGraph, KNDLMeta
from kndl.storage import KNDLStorage, create_storage
from kndl.backends.sqlite_backend import SQLiteStorage


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mem_storage() -> SQLiteStorage:
    return SQLiteStorage("sqlite:///:memory:")


def _sample_node(node_id: str = "n1", type_name: str = "Temperature") -> GraphNode:
    return GraphNode(
        id=node_id,
        type_name=type_name,
        fields={"value": 22.5, "unit": "°C"},
        meta=KNDLMeta(confidence=0.9, source="sensor://test"),
    )


def _sample_edge(edge_id: str = "e1") -> GraphEdge:
    return GraphEdge(
        id=edge_id,
        source_id="n1",
        target_id="n2",
        edge_type="located_in",
        fields={"weight": 0.8},
    )


def _sample_intent(intent_id: str = "i1") -> GraphIntent:
    return GraphIntent(
        id=intent_id,
        type_name="Action",
        trigger_kind="expression",
        trigger_data="@n1.value > 30",
        actions=[{"type": "emit", "node_type": "Alert"}],
        meta=KNDLMeta(priority=0.9),
    )


# ── Protocol conformance ──────────────────────────────────────────────────────

class TestStorageProtocol:
    def test_sqlite_implements_protocol(self) -> None:
        s = _mem_storage()
        assert isinstance(s, KNDLStorage)
        s.close()


# ── create_storage factory ────────────────────────────────────────────────────

class TestCreateStorage:
    def test_none_returns_none(self) -> None:
        assert create_storage("") is None

    def test_memory_string_returns_none(self) -> None:
        assert create_storage("memory") is None
        assert create_storage("MEMORY") is None
        assert create_storage("none") is None

    def test_sqlite_in_memory(self) -> None:
        s = create_storage("sqlite:///:memory:")
        assert s is not None
        assert isinstance(s, SQLiteStorage)
        s.close()

    def test_sqlite_file(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        db = tmp_path / "test.db"
        s = create_storage(f"sqlite:///{db}")
        assert s is not None
        s.close()

    def test_unsupported_scheme_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported DATABASE_URL"):
            create_storage("mysql://localhost/db")

    def test_reads_env_var(self, monkeypatch) -> None:  # type: ignore[no-untyped-def]
        monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
        s = create_storage()
        assert s is not None
        s.close()

    def test_explicit_url_overrides_env(self, monkeypatch) -> None:  # type: ignore[no-untyped-def]
        monkeypatch.setenv("DATABASE_URL", "postgresql://never/used")
        s = create_storage("sqlite:///:memory:")
        assert isinstance(s, SQLiteStorage)
        s.close()


# ── SQLite CRUD ───────────────────────────────────────────────────────────────

class TestSQLiteCRUD:
    def test_node_upsert_and_load(self) -> None:
        s = _mem_storage()
        node = _sample_node()
        s.upsert_node(node)
        nodes, edges, intents = s.load()
        assert len(nodes) == 1
        assert nodes[0]["id"] == "n1"
        assert nodes[0]["type"] == "Temperature"
        assert nodes[0]["fields"]["value"] == 22.5
        assert nodes[0]["meta"]["confidence"] == 0.9
        s.close()

    def test_node_upsert_replaces(self) -> None:
        s = _mem_storage()
        node = _sample_node()
        s.upsert_node(node)
        node.fields["value"] = 99.0
        s.upsert_node(node)
        nodes, _, _ = s.load()
        assert len(nodes) == 1
        assert nodes[0]["fields"]["value"] == 99.0
        s.close()

    def test_node_delete(self) -> None:
        s = _mem_storage()
        s.upsert_node(_sample_node())
        s.delete_node("n1")
        nodes, _, _ = s.load()
        assert nodes == []
        s.close()

    def test_edge_upsert_and_load(self) -> None:
        s = _mem_storage()
        s.upsert_edge(_sample_edge())
        _, edges, _ = s.load()
        assert len(edges) == 1
        e = edges[0]
        assert e["id"] == "e1"
        assert e["source"] == "n1"
        assert e["target"] == "n2"
        assert e["type"] == "located_in"
        s.close()

    def test_edge_delete(self) -> None:
        s = _mem_storage()
        s.upsert_edge(_sample_edge())
        s.delete_edge("e1")
        _, edges, _ = s.load()
        assert edges == []
        s.close()

    def test_intent_upsert_and_load(self) -> None:
        s = _mem_storage()
        s.upsert_intent(_sample_intent())
        _, _, intents = s.load()
        assert len(intents) == 1
        i = intents[0]
        assert i["id"] == "i1"
        assert i["type"] == "Action"
        assert i["trigger_kind"] == "expression"
        assert i["trigger_data"] == "@n1.value > 30"
        assert len(i["actions"]) == 1
        s.close()

    def test_intent_delete(self) -> None:
        s = _mem_storage()
        s.upsert_intent(_sample_intent())
        s.delete_intent("i1")
        _, _, intents = s.load()
        assert intents == []
        s.close()

    def test_clear(self) -> None:
        s = _mem_storage()
        s.upsert_node(_sample_node())
        s.upsert_edge(_sample_edge())
        s.upsert_intent(_sample_intent())
        s.clear()
        nodes, edges, intents = s.load()
        assert nodes == edges == intents == []
        s.close()

    def test_multiple_items(self) -> None:
        s = _mem_storage()
        for i in range(5):
            s.upsert_node(_sample_node(f"node_{i}", "Sensor"))
        nodes, _, _ = s.load()
        assert len(nodes) == 5
        s.close()


# ── Persistence roundtrip ─────────────────────────────────────────────────────

class TestPersistenceRoundtrip:
    def test_file_survives_reopen(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        db_url = f"sqlite:///{tmp_path / 'kndl_test.db'}"

        s1 = SQLiteStorage(db_url)
        s1.upsert_node(_sample_node("persist_node"))
        s1.upsert_edge(_sample_edge("persist_edge"))
        s1.upsert_intent(_sample_intent("persist_intent"))
        s1.close()

        s2 = SQLiteStorage(db_url)
        nodes, edges, intents = s2.load()
        assert any(n["id"] == "persist_node" for n in nodes)
        assert any(e["id"] == "persist_edge" for e in edges)
        assert any(i["id"] == "persist_intent" for i in intents)
        s2.close()

    def test_graph_from_storage_loads_data(self) -> None:
        s = _mem_storage()
        s.upsert_node(_sample_node("loaded_node"))
        s.upsert_edge(_sample_edge("loaded_edge"))
        s.upsert_intent(_sample_intent("loaded_intent"))

        g = KNDLGraph.from_storage(s)
        assert "loaded_node" in g.nodes
        assert "loaded_edge" in g.edges
        assert "loaded_intent" in g.intents
        s.close()

    def test_graph_changes_persist(self) -> None:
        s = _mem_storage()
        g = KNDLGraph(storage=s)

        g.add_node(_sample_node("p1"))
        g.add_edge(_sample_edge("pe1"))
        g.add_intent(_sample_intent("pi1"))

        nodes, edges, intents = s.load()
        assert any(n["id"] == "p1" for n in nodes)
        assert any(e["id"] == "pe1" for e in edges)
        assert any(i["id"] == "pi1" for i in intents)

        g.remove_node("p1")
        nodes, _, _ = s.load()
        assert not any(n["id"] == "p1" for n in nodes)

        g.remove_edge("pe1")
        _, edges, _ = s.load()
        assert not any(e["id"] == "pe1" for e in edges)

        g.remove_intent("pi1")
        _, _, intents = s.load()
        assert not any(i["id"] == "pi1" for i in intents)

        s.close()


# ── KNDLGraph.remove_intent ───────────────────────────────────────────────────

class TestRemoveIntent:
    def test_remove_intent_in_memory(self) -> None:
        g = KNDLGraph()
        g.add_intent(_sample_intent("ri1"))
        assert "ri1" in g.intents
        result = g.remove_intent("ri1")
        assert result is True
        assert "ri1" not in g.intents

    def test_remove_missing_intent_returns_false(self) -> None:
        g = KNDLGraph()
        assert g.remove_intent("nonexistent") is False

    def test_remove_intent_with_storage(self) -> None:
        s = _mem_storage()
        g = KNDLGraph(storage=s)
        g.add_intent(_sample_intent("si1"))
        _, _, intents = s.load()
        assert any(i["id"] == "si1" for i in intents)

        g.remove_intent("si1")
        _, _, intents = s.load()
        assert not any(i["id"] == "si1" for i in intents)
        s.close()


# ── Meta roundtrip ────────────────────────────────────────────────────────────

class TestMetaRoundtrip:
    def test_full_meta_survives_storage(self) -> None:
        s = _mem_storage()
        node = GraphNode(
            id="meta_test",
            type_name="Sensor",
            fields={"v": 1},
            meta=KNDLMeta(
                confidence=0.75,
                source="agent://test",
                valid_start="2026-01-01T00:00:00Z",
                valid_end="2026-12-31T23:59:59Z",
                decay_rate=0.9,
                decay_duration_seconds=3600.0,
                tags=["iot", "temperature"],
                priority=0.8,
            ),
        )
        s.upsert_node(node)
        nodes, _, _ = s.load()
        m = nodes[0]["meta"]
        assert m["confidence"] == 0.75
        assert m["source"] == "agent://test"
        assert m["tags"] == ["iot", "temperature"]
        assert m["decay_rate"] == 0.9
        s.close()
