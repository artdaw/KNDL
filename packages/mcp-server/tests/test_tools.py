"""
Integration tests for the KNDL MCP server tools.

Tests call the tool functions directly (bypassing the MCP protocol layer)
to verify that graph state is correctly maintained and that all 13 tools
produce the expected JSON payloads.

Each test class resets the in-memory graph via kndl_reset() to ensure
isolation.
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python", "src"))

from kndl_mcp.server import (
    kndl_parse,
    kndl_add_node,
    kndl_add_edge,
    kndl_query_nodes,
    kndl_get_node,
    kndl_update_node,
    kndl_remove_node,
    kndl_neighborhood,
    kndl_serialize,
    kndl_graph_stats,
    kndl_add_intent,
    kndl_merge_graphs,
    kndl_reset,
    kndl_get_types,
    spec_grammar,
    spec_language,
    spec_version,
    graph_types,
)


@pytest.fixture(autouse=True)
def clean_graph():
    """Reset the in-memory graph before each test."""
    kndl_reset()
    yield
    kndl_reset()


# ── kndl_reset ────────────────────────────────────────────────────────────────

class TestReset:
    def test_reset_returns_ok(self):
        result = kndl_reset()
        assert result["status"] == "ok"

    def test_reset_clears_nodes(self):
        kndl_add_node("n1", "Foo")
        kndl_reset()
        result = kndl_query_nodes()
        assert result["count"] == 0

    def test_reset_clears_edges(self):
        kndl_add_node("a", "Foo")
        kndl_add_node("b", "Bar")
        kndl_add_edge("a", "b")
        kndl_reset()
        stats = kndl_graph_stats()
        assert stats["stats"]["edge_count"] == 0


# ── kndl_add_node ─────────────────────────────────────────────────────────────

class TestAddNode:
    def test_add_simple_node(self):
        result = kndl_add_node("sensor_01", "Temperature")
        assert result["status"] == "ok"
        assert result["node"]["id"] == "sensor_01"
        assert result["node"]["type"] == "Temperature"

    def test_add_node_with_fields(self):
        result = kndl_add_node("s", "Sensor", fields={"value": 22.5, "unit": "°C"})
        assert result["status"] == "ok"
        assert result["node"]["fields"]["value"] == 22.5
        assert result["node"]["fields"]["unit"] == "°C"

    def test_add_node_with_confidence(self):
        result = kndl_add_node("s", "Sensor", confidence=0.87)
        assert result["node"]["meta"]["confidence"] == 0.87

    def test_add_node_with_source(self):
        result = kndl_add_node("s", "Sensor", source="agent://test")
        assert result["node"]["meta"]["source"] == "agent://test"

    def test_add_node_with_valid_range(self):
        result = kndl_add_node(
            "s", "Event",
            valid_start="2026-01-01T00:00Z",
            valid_end="2026-12-31T23:59Z",
        )
        assert result["node"]["meta"]["valid_start"] == "2026-01-01T00:00Z"
        assert result["node"]["meta"]["valid_end"] == "2026-12-31T23:59Z"

    def test_add_node_with_decay(self):
        result = kndl_add_node("s", "Sensor", decay_rate=0.95, decay_duration="1h")
        assert result["node"]["meta"]["decay_rate"] == 0.95
        assert result["node"]["meta"]["decay_duration_seconds"] == 3600.0

    def test_add_node_with_tags(self):
        result = kndl_add_node("s", "Sensor", tags=["iot", "outdoor"])
        assert "iot" in result["node"]["meta"]["tags"]
        assert "outdoor" in result["node"]["meta"]["tags"]

    def test_add_node_persists_in_graph(self):
        kndl_add_node("n1", "Widget")
        result = kndl_query_nodes(type_name="Widget")
        assert result["count"] == 1


# ── kndl_add_edge ─────────────────────────────────────────────────────────────

class TestAddEdge:
    def test_add_simple_edge(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b")
        assert result["status"] == "ok"
        assert result["edge"]["source"] == "a"
        assert result["edge"]["target"] == "b"

    def test_add_edge_with_type(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b", edge_type="located_in")
        assert result["edge"]["type"] == "located_in"

    def test_add_edge_with_confidence(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b", confidence=0.75)
        assert result["edge"]["meta"]["confidence"] == 0.75

    def test_add_edge_with_source_uri(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b", source_uri="agent://test")
        assert result["edge"]["meta"]["source"] == "agent://test"

    def test_edge_appears_in_stats(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        kndl_add_edge("a", "b")
        stats = kndl_graph_stats()
        assert stats["stats"]["edge_count"] == 1


# ── kndl_parse ────────────────────────────────────────────────────────────────

class TestParse:
    SENSOR_SRC = """
node @sensor_01 :: Temperature {
  value    = 22.5
  unit     = "°C"
  location -> @berlin
  ~confidence 0.94
  ~source     "sensor://t-001"
}
"""

    def test_parse_valid_kndl(self):
        result = kndl_parse(self.SENSOR_SRC)
        assert result["status"] == "ok"
        assert result["graph"]["summary"]["node_count"] >= 1

    def test_parse_creates_node(self):
        kndl_parse(self.SENSOR_SRC)
        result = kndl_query_nodes(type_name="Temperature")
        assert result["count"] == 1
        assert result["nodes"][0]["id"] == "sensor_01"

    def test_parse_invalid_kndl_returns_error(self):
        result = kndl_parse("!!! not valid kndl !!!")
        assert result["status"] == "error"
        assert "message" in result

    def test_parse_merges_into_existing_graph(self):
        kndl_add_node("existing", "Widget")
        kndl_parse(self.SENSOR_SRC)
        stats = kndl_graph_stats()
        assert stats["stats"]["node_count"] >= 2

    def test_parse_empty_source(self):
        result = kndl_parse("")
        assert result["status"] == "ok"


# ── kndl_query_nodes ──────────────────────────────────────────────────────────

class TestQueryNodes:
    def setup_method(self):
        kndl_reset()
        kndl_add_node("t1", "Temperature", fields={"value": 22.5}, confidence=0.9)
        kndl_add_node("t2", "Temperature", fields={"value": 35.0}, confidence=0.4)
        kndl_add_node("r1", "Room",        fields={"name": "Lab"},  confidence=0.8)

    def test_query_all(self):
        result = kndl_query_nodes()
        assert result["count"] == 3

    def test_query_by_type(self):
        result = kndl_query_nodes(type_name="Temperature")
        assert result["count"] == 2

    def test_query_by_min_confidence(self):
        result = kndl_query_nodes(min_confidence=0.8)
        ids = [n["id"] for n in result["nodes"]]
        assert "t1" in ids
        assert "t2" not in ids

    def test_query_by_field_filter(self):
        result = kndl_query_nodes(field_filters={"name": "Lab"})
        assert result["count"] == 1
        assert result["nodes"][0]["id"] == "r1"

    def test_query_returns_ok(self):
        result = kndl_query_nodes()
        assert result["status"] == "ok"


# ── kndl_get_node ─────────────────────────────────────────────────────────────

class TestGetNode:
    def setup_method(self):
        kndl_reset()
        kndl_add_node("a", "T", confidence=0.9)
        kndl_add_node("b", "T", confidence=0.8)
        kndl_add_edge("a", "b", edge_type="links")

    def test_get_existing_node(self):
        result = kndl_get_node("a")
        assert result["status"] == "ok"
        assert result["node"]["id"] == "a"

    def test_get_node_includes_outgoing_edges(self):
        result = kndl_get_node("a")
        outgoing = result["node"]["outgoing_edges"]
        assert len(outgoing) == 1
        assert outgoing[0]["target"] == "b"

    def test_get_node_includes_incoming_edges(self):
        result = kndl_get_node("b")
        incoming = result["node"]["incoming_edges"]
        assert len(incoming) == 1
        assert incoming[0]["source"] == "a"

    def test_get_nonexistent_node_returns_error(self):
        result = kndl_get_node("does_not_exist")
        assert result["status"] == "error"

    def test_get_node_includes_effective_confidence(self):
        result = kndl_get_node("a")
        assert "effective_confidence" in result["node"]


# ── kndl_update_node ──────────────────────────────────────────────────────────

class TestUpdateNode:
    def setup_method(self):
        kndl_reset()
        kndl_add_node("n1", "Sensor", fields={"value": 10.0}, confidence=0.5)

    def test_update_fields(self):
        result = kndl_update_node("n1", fields={"value": 99.0})
        assert result["status"] == "ok"
        get = kndl_get_node("n1")
        assert get["node"]["fields"]["value"] == 99.0

    def test_update_confidence(self):
        kndl_update_node("n1", confidence=0.99)
        get = kndl_get_node("n1")
        assert get["node"]["meta"]["confidence"] == 0.99

    def test_update_source(self):
        kndl_update_node("n1", source="agent://updated")
        get = kndl_get_node("n1")
        assert get["node"]["meta"]["source"] == "agent://updated"

    def test_update_nonexistent_node_returns_error(self):
        result = kndl_update_node("ghost", fields={"x": 1})
        assert result["status"] == "error"


# ── kndl_remove_node ──────────────────────────────────────────────────────────

class TestRemoveNode:
    def setup_method(self):
        kndl_reset()
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        kndl_add_edge("a", "b")

    def test_remove_existing_node(self):
        result = kndl_remove_node("a")
        assert result["status"] == "ok"
        assert kndl_get_node("a")["status"] == "error"

    def test_remove_node_cleans_edges(self):
        kndl_remove_node("a")
        stats = kndl_graph_stats()
        assert stats["stats"]["edge_count"] == 0

    def test_remove_nonexistent_node_returns_error(self):
        result = kndl_remove_node("ghost")
        assert result["status"] == "error"


# ── kndl_neighborhood ─────────────────────────────────────────────────────────

class TestNeighborhood:
    def setup_method(self):
        kndl_reset()
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        kndl_add_node("c", "T")
        kndl_add_edge("a", "b")
        kndl_add_edge("b", "c")

    def test_one_hop(self):
        result = kndl_neighborhood("a", hops=1)
        assert result["status"] == "ok"
        ids = {n["id"] for n in result["nodes"]}
        assert "a" in ids
        assert "b" in ids
        assert "c" not in ids

    def test_two_hop(self):
        result = kndl_neighborhood("a", hops=2)
        ids = {n["id"] for n in result["nodes"]}
        assert "c" in ids

    def test_nonexistent_center_returns_error(self):
        result = kndl_neighborhood("ghost", hops=1)
        assert result["status"] == "error"


# ── kndl_serialize ────────────────────────────────────────────────────────────

class TestSerialize:
    def test_serialize_empty_graph(self):
        result = kndl_serialize()
        assert result["status"] == "ok"
        assert "kndl_text" in result

    def test_serialize_contains_nodes(self):
        kndl_add_node("n1", "Temperature", confidence=0.9)
        result = kndl_serialize()
        assert "n1" in result["kndl_text"]
        assert "Temperature" in result["kndl_text"]

    def test_serialize_stats_match_graph(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        kndl_add_edge("a", "b")
        result = kndl_serialize()
        assert result["stats"]["node_count"] == 2
        assert result["stats"]["edge_count"] == 1


# ── kndl_graph_stats ──────────────────────────────────────────────────────────

class TestGraphStats:
    def test_empty_graph_stats(self):
        result = kndl_graph_stats()
        assert result["status"] == "ok"
        assert result["stats"]["node_count"] == 0
        assert result["stats"]["edge_count"] == 0
        assert result["stats"]["average_confidence"] == 0.0

    def test_type_distribution(self):
        kndl_add_node("a", "Temp")
        kndl_add_node("b", "Temp")
        kndl_add_node("c", "Room")
        result = kndl_graph_stats()
        dist = result["stats"]["type_distribution"]
        assert dist["Temp"] == 2
        assert dist["Room"] == 1

    def test_average_confidence(self):
        kndl_add_node("a", "T", confidence=0.8)
        kndl_add_node("b", "T", confidence=0.6)
        result = kndl_graph_stats()
        assert abs(result["stats"]["average_confidence"] - 0.7) < 0.001


# ── kndl_add_intent ───────────────────────────────────────────────────────────

class TestAddIntent:
    def test_add_simple_intent(self):
        result = kndl_add_intent("alert_01", type_name="Action")
        assert result["status"] == "ok"
        assert result["intent"]["id"] == "alert_01"

    def test_add_intent_with_cooldown(self):
        result = kndl_add_intent("i1", cooldown="15m")
        assert result["intent"]["meta"]["cooldown_seconds"] == 900.0

    def test_add_intent_with_priority(self):
        result = kndl_add_intent("i1", priority=0.95)
        assert result["intent"]["meta"]["priority"] == 0.95

    def test_add_intent_with_cron_trigger(self):
        result = kndl_add_intent("i1", trigger_kind="cron", trigger_data="0 0 * * *")
        assert result["intent"]["trigger"]["kind"] == "cron"
        assert result["intent"]["trigger"]["data"] == "0 0 * * *"

    def test_intent_appears_in_stats(self):
        kndl_add_intent("i1")
        stats = kndl_graph_stats()
        assert stats["stats"]["intent_count"] == 1


# ── kndl_merge_graphs ─────────────────────────────────────────────────────────

class TestMergeGraphs:
    def test_merge_adds_new_nodes(self):
        result = kndl_merge_graphs("""
node @alice :: Person { name = "Alice" ~confidence 0.9 }
""")
        assert result["status"] == "ok"
        assert result["new_nodes"] == 1

    def test_merge_updates_existing_node(self):
        kndl_add_node("alice", "Person", fields={"name": "Alice"}, confidence=0.5)
        kndl_merge_graphs("""
node @alice :: Person { name = "Alice Updated" ~confidence 0.9 }
""")
        get = kndl_get_node("alice")
        assert get["node"]["meta"]["confidence"] == 0.9

    def test_merge_invalid_source_returns_error(self):
        result = kndl_merge_graphs("!!! invalid !!!")
        assert result["status"] == "error"

    def test_merge_accumulates_edges(self):
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        kndl_merge_graphs("edge @a -[links]-> @b")
        stats = kndl_graph_stats()
        assert stats["stats"]["edge_count"] == 1

    def test_merge_preserves_existing_nodes(self):
        kndl_add_node("existing", "Widget")
        kndl_merge_graphs("node @new_node :: Gadget { val = 1 }")
        stats = kndl_graph_stats()
        assert stats["stats"]["node_count"] == 2


# ── kndl_get_types ────────────────────────────────────────────────────────────

class TestGetTypes:
    def test_empty_graph_returns_empty(self):
        result = kndl_get_types()
        assert result["status"] == "ok"
        assert result["count"] == 0
        assert result["types"] == {}

    def test_parse_type_decl_populates_types(self):
        kndl_parse("""
type SmartRoom {
  temp : Float
  unit : String
}
""")
        result = kndl_get_types()
        assert result["status"] == "ok"
        assert result["count"] == 1
        assert "SmartRoom" in result["types"]
        t = result["types"]["SmartRoom"]
        assert t["fields"]["temp"] == "Float"
        assert t["fields"]["unit"] == "String"

    def test_get_single_type_by_name(self):
        kndl_parse("type Protocol = \"knx\" | \"bacnet\"")
        result = kndl_get_types(type_name="Protocol")
        assert result["status"] == "ok"
        assert result["type"]["name"] == "Protocol"

    def test_get_missing_type_returns_error(self):
        result = kndl_get_types(type_name="DoesNotExist")
        assert result["status"] == "error"

    def test_multiple_types(self):
        kndl_parse("""
type Foo { x : Int }
type Bar { y : String }
""")
        result = kndl_get_types()
        assert result["count"] == 2
        assert "Foo" in result["types"]
        assert "Bar" in result["types"]


# ── Schema resources ──────────────────────────────────────────────────────────

class TestSchemaResources:
    def test_spec_version_contains_version(self):
        text = spec_version()
        assert "KNDL" in text
        assert "v" in text

    def test_spec_grammar_returns_ebnf(self):
        text = spec_grammar()
        assert "program" in text
        assert "node_decl" in text

    def test_spec_language_returns_markdown(self):
        text = spec_language()
        assert len(text) > 500
        assert "KNDL" in text

    def test_graph_types_resource_empty(self):
        import json
        text = graph_types()
        data = json.loads(text)
        assert data["count"] == 0
        assert data["types"] == {}

    def test_graph_types_resource_after_parse(self):
        import json
        kndl_parse("type Sensor { value : Float }")
        text = graph_types()
        data = json.loads(text)
        assert data["count"] == 1
        assert "Sensor" in data["types"]


# ── v0.2 additions ────────────────────────────────────────────────────────────

class TestV02Features:
    def test_duration_mo_in_add_node(self):
        """CalDuration 'mo' works in decay_duration."""
        result = kndl_add_node("n", "T", decay_rate=0.9, decay_duration="1mo")
        assert result["status"] == "ok"
        assert result["node"]["meta"]["decay_duration_seconds"] == pytest.approx(2592000.0)

    def test_duration_y_in_add_node(self):
        """CalDuration 'y' works in decay_duration."""
        result = kndl_add_node("n", "T", decay_rate=0.5, decay_duration="1y")
        assert result["node"]["meta"]["decay_duration_seconds"] == pytest.approx(31536000.0)

    def test_duration_ns_in_add_node(self):
        """Duration 'ns' works in decay_duration."""
        result = kndl_add_node("n", "T", decay_rate=0.99, decay_duration="500ns")
        assert result["node"]["meta"]["decay_duration_seconds"] == pytest.approx(5e-7)

    def test_add_node_v02_meta_recorded(self):
        """recorded meta field is stored and returned."""
        result = kndl_add_node("n", "T", recorded="2026-04-23T10:00Z")
        assert result["status"] == "ok"
        assert result["node"]["meta"]["recorded"] == "2026-04-23T10:00Z"

    def test_add_node_v02_meta_negated(self):
        """negated meta field is stored and returned."""
        result = kndl_add_node("n", "T", negated=True)
        assert result["node"]["meta"]["negated"] is True

    def test_add_node_v02_meta_classification(self):
        """classification meta field is stored and returned."""
        result = kndl_add_node("n", "T", classification="confidential")
        assert result["node"]["meta"]["classification"] == "confidential"

    def test_add_node_v02_meta_uncertainty(self):
        """uncertainty meta field is stored and returned."""
        u = {"_type": "gaussian", "mean": 0.5, "std": 0.1}
        result = kndl_add_node("n", "T", uncertainty=u)
        assert result["node"]["meta"]["uncertainty"]["_type"] == "gaussian"

    def test_add_edge_undirected_direction(self):
        """kndl_add_edge supports direction='undirected'."""
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b", edge_type="peer", direction="undirected")
        assert result["status"] == "ok"
        assert result["edge"]["direction"] == "undirected"

    def test_add_edge_bidirectional_direction(self):
        """kndl_add_edge supports direction='bidirectional'."""
        kndl_add_node("a", "T")
        kndl_add_node("b", "T")
        result = kndl_add_edge("a", "b", direction="bidirectional")
        assert result["edge"]["direction"] == "bidirectional"

    def test_parse_process_propagates_to_graph(self):
        """kndl_parse imports process declarations into the graph."""
        result = kndl_parse("""
process @order :: OrderProcess {
  state PENDING {}
  state DONE {}
  on complete in PENDING -> DONE
}
""")
        assert result["status"] == "ok"
        from kndl_mcp.server import _get_graph
        g = _get_graph()
        assert "order" in g.processes

    def test_merge_process_propagates(self):
        """kndl_merge_graphs imports process declarations."""
        result = kndl_merge_graphs("""
process @flow :: MyFlow {
  state A {}
  state B {}
  on go in A -> B
}
""")
        assert result["status"] == "ok"
        from kndl_mcp.server import _get_graph
        assert "flow" in _get_graph().processes

    def test_graph_stats_includes_process_count(self):
        """kndl_graph_stats reports process_count."""
        stats = kndl_graph_stats()
        assert "process_count" in stats["stats"]

    def test_serialize_stats_includes_process_count(self):
        """kndl_serialize stats include process_count."""
        result = kndl_serialize()
        assert "process_count" in result["stats"]
