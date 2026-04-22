"""
KNDL test suite — covers lexer, parser, compiler, and serializer.
Run with: pytest
"""

import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from kndl import (
    parse, compile, serialize, tokenize,
    ParseError,
    KNDLGraph
)
from kndl.lexer import TokenType

# ── Fixtures ──────────────────────────────────────────────────────────────────

SIMPLE_NODE = """
node @sensor_01 :: Temperature {
  value    = 22.5
  unit     = "°C"
  location -> @building_7
  ~confidence 0.94
  ~source     "sensor://bldg-7/t-001"
  ~valid      2026-04-10T14:00Z .. *
  ~decay      0.95 / 1h
}
"""

EDGE_DECL = """
edge @room_204 -[located_in]-> @floor_2 {
  ~weight 0.95
}
"""

TYPE_DECL = """
type SmartRoom {
  temp : Float
  unit : String
}

type Protocol = "knx" | "bacnet"
"""

CONTEXT_DECL = """
context @campus {
  ~source "system://dt"
  ~access "role:ops"

  node @building_7 :: Building {
    name = "HQ"
    floors = 4
    ~confidence 0.99
  }
}
"""

INTENT_DECL = """
intent @overheat :: Action {
  trigger = @sensor_01.value > 30.0
  do {
    emit :: Alert { level = "critical" }
  }
  ~priority 0.9
  ~cooldown 15m
}
"""

QUERY_DECL = """
query hot_rooms {
  match ?sensor :: Temperature
    -[located_in]-> ?room :: Room
  where ?sensor.value > 26.0
  return ?room
}
"""


# ── Lexer tests ───────────────────────────────────────────────────────────────

class TestLexer:
    def test_tokenize_keywords(self):
        tokens = tokenize("node edge type intent context query")
        types = [t.type for t in tokens if t.type.name != "EOF"]
        assert TokenType.KW_NODE in types
        assert TokenType.KW_EDGE in types
        assert TokenType.KW_TYPE in types
        assert TokenType.KW_INTENT in types
        assert TokenType.KW_CONTEXT in types
        assert TokenType.KW_QUERY in types

    def test_tokenize_node_ref(self):
        tokens = tokenize("@sensor_01")
        assert tokens[0].type == TokenType.NODE_REF
        assert tokens[0].value == "@sensor_01"

    def test_tokenize_meta_key(self):
        tokens = tokenize("~confidence")
        assert tokens[0].type == TokenType.META_KEY
        assert tokens[0].value == "confidence"

    def test_tokenize_float(self):
        tokens = tokenize("0.94")
        assert tokens[0].type == TokenType.FLOAT
        assert float(tokens[0].value) == 0.94

    def test_tokenize_duration(self):
        tokens = tokenize("1h 30m 5s 100ms")
        duration_tokens = [t for t in tokens if t.type == TokenType.DURATION]
        assert len(duration_tokens) == 4
        assert duration_tokens[0].value == "1h"
        assert duration_tokens[3].value == "100ms"

    def test_tokenize_datetime(self):
        tokens = tokenize("2026-04-10T14:00Z")
        assert tokens[0].type == TokenType.DATETIME

    def test_tokenize_string(self):
        tokens = tokenize('"hello world"')
        assert tokens[0].type == TokenType.STRING
        assert tokens[0].value == "hello world"

    def test_tokenize_string_escape(self):
        tokens = tokenize(r'"hello\nworld"')
        assert tokens[0].type == TokenType.STRING
        assert "\n" in tokens[0].value

    def test_typed_arrow(self):
        tokens = tokenize("-[located_in]->")
        types = [t.type for t in tokens]
        assert TokenType.TYPED_ARROW_START in types
        assert TokenType.TYPED_ARROW_END in types

    def test_range_operator(self):
        tokens = tokenize("2026-04-10T14:00Z .. *")
        types = [t.type for t in tokens]
        assert TokenType.OP_RANGE in types

    def test_line_comment_stripped(self):
        tokens = tokenize("node // this is a comment\nedge")
        types = [t.type for t in tokens if t.type != TokenType.EOF]
        assert TokenType.KW_NODE in types
        assert TokenType.KW_EDGE in types

    def test_block_comment_stripped(self):
        tokens = tokenize("node /* block comment */ edge")
        types = [t.type for t in tokens if t.type != TokenType.EOF]
        assert TokenType.KW_NODE in types
        assert TokenType.KW_EDGE in types


# ── Parser tests ──────────────────────────────────────────────────────────────

class TestParser:
    def test_parse_simple_node(self):
        program = parse(SIMPLE_NODE)
        assert len(program.nodes) == 1
        node = program.nodes[0]
        assert node.ref.name == "sensor_01"
        assert node.type_name == "Temperature"

    def test_parse_node_fields(self):
        program = parse(SIMPLE_NODE)
        node = program.nodes[0]
        fields = {f.name: f for f in node.fields}
        assert "value" in fields
        assert "unit" in fields

    def test_parse_inline_edge(self):
        program = parse(SIMPLE_NODE)
        node = program.nodes[0]
        assert len(node.edges) == 1
        assert node.edges[0].field_name == "location"
        assert node.edges[0].target.name == "building_7"

    def test_parse_meta_annotations(self):
        program = parse(SIMPLE_NODE)
        node = program.nodes[0]
        meta_keys = {m.key for m in node.meta}
        assert "confidence" in meta_keys
        assert "source" in meta_keys
        assert "valid" in meta_keys
        assert "decay" in meta_keys

    def test_parse_edge_decl(self):
        program = parse(EDGE_DECL)
        assert len(program.edges) == 1
        edge = program.edges[0]
        assert edge.source.name == "room_204"
        assert edge.edge_type == "located_in"
        assert len(edge.targets) == 1
        assert edge.targets[0].name == "floor_2"

    def test_parse_type_decl(self):
        program = parse(TYPE_DECL)
        assert len(program.types) == 2
        assert program.types[0].name == "SmartRoom"

    def test_parse_context_decl(self):
        program = parse(CONTEXT_DECL)
        assert len(program.contexts) == 1
        ctx = program.contexts[0]
        assert ctx.ref.name == "campus"
        assert len(ctx.nodes) == 1

    def test_parse_intent_decl(self):
        program = parse(INTENT_DECL)
        assert len(program.intents) == 1
        intent = program.intents[0]
        assert intent.ref.name == "overheat"
        assert intent.type_name == "Action"
        assert intent.trigger is not None
        assert intent.trigger.kind == "expression"

    def test_parse_query_decl(self):
        program = parse(QUERY_DECL)
        assert len(program.queries) == 1
        q = program.queries[0]
        assert q.name == "hot_rooms"
        assert len(q.matches) == 1

    def test_parse_cron_trigger(self):
        src = """intent @monthly :: ScheduledAction {
          trigger = cron "0 0 1 * *"
          do { emit :: Report }
          ~priority 0.5
        }"""
        program = parse(src)
        assert program.intents[0].trigger.kind == "cron"
        assert program.intents[0].trigger.cron_expr == "0 0 1 * *"

    def test_parse_multi_target_edge(self):
        src = "edge @building_7 -[contains]-> [ @floor_1, @floor_2, @floor_3 ]"
        program = parse(src)
        edge = program.edges[0]
        assert len(edge.targets) == 3

    def test_parse_type_union(self):
        src = 'type Protocol = "knx" | "bacnet" | "modbus"'
        program = parse(src)
        assert program.types[0].type_expr.kind == "union"

    def test_parse_type_intersection(self):
        src = "type SmartSensor = Device & Measurement"
        program = parse(src)
        assert program.types[0].type_expr.kind == "intersection"

    def test_parse_optional_type(self):
        src = "type Sensor { location : Place? }"
        program = parse(src)
        fields = program.types[0].fields
        assert fields[0].name == "location"
        assert fields[0].type_expr.kind == "optional"

    def test_parse_error_unexpected_token(self):
        import pytest
        with pytest.raises(ParseError):
            parse("!!! invalid !!!")

    def test_parse_import(self):
        src = 'import { Temperature, Measurement } from "kndl://std/units"'
        program = parse(src)
        assert len(program.imports) == 1
        assert "Temperature" in program.imports[0].names
        assert program.imports[0].source == "kndl://std/units"


# ── Compiler tests ────────────────────────────────────────────────────────────

class TestCompiler:
    def test_compile_node(self):
        graph = compile(SIMPLE_NODE)
        assert "sensor_01" in graph.nodes
        node = graph.nodes["sensor_01"]
        assert node.type_name == "Temperature"
        assert node.fields["value"] == 22.5
        assert node.fields["unit"] == "°C"

    def test_compile_meta_confidence(self):
        graph = compile(SIMPLE_NODE)
        node = graph.nodes["sensor_01"]
        assert node.meta.confidence == 0.94

    def test_compile_meta_source(self):
        graph = compile(SIMPLE_NODE)
        node = graph.nodes["sensor_01"]
        assert node.meta.source == "sensor://bldg-7/t-001"

    def test_compile_meta_valid(self):
        graph = compile(SIMPLE_NODE)
        node = graph.nodes["sensor_01"]
        assert node.meta.valid_start == "2026-04-10T14:00Z"
        assert node.meta.valid_end is None  # * → open-ended

    def test_compile_meta_decay(self):
        graph = compile(SIMPLE_NODE)
        node = graph.nodes["sensor_01"]
        assert node.meta.decay_rate == 0.95
        assert node.meta.decay_duration_seconds == 3600.0  # 1h

    def test_compile_inline_edge(self):
        graph = compile(SIMPLE_NODE)
        edges = graph.get_outgoing_edges("sensor_01")
        assert len(edges) == 1
        assert edges[0].target_id == "building_7"
        assert edges[0].edge_type == "location"

    def test_compile_standalone_edge(self):
        graph = compile(EDGE_DECL)
        edges = graph.edges
        edge = next(iter(edges.values()))
        assert edge.source_id == "room_204"
        assert edge.target_id == "floor_2"
        assert edge.edge_type == "located_in"

    def test_compile_context_inherits_meta(self):
        graph = compile(CONTEXT_DECL)
        assert "building_7" in graph.nodes
        node = graph.nodes["building_7"]
        assert node.meta.source == "system://dt"
        assert node.meta.access == "role:ops"

    def test_compile_context_node_overrides(self):
        graph = compile(CONTEXT_DECL)
        node = graph.nodes["building_7"]
        # Node's own ~confidence 0.99 should win over context default
        assert node.meta.confidence == 0.99

    def test_compile_intent(self):
        graph = compile(INTENT_DECL)
        assert "overheat" in graph.intents
        intent = graph.intents["overheat"]
        assert intent.type_name == "Action"
        assert intent.trigger_kind == "expression"
        assert intent.meta.priority == 0.9

    def test_compile_intent_cooldown(self):
        graph = compile(INTENT_DECL)
        intent = graph.intents["overheat"]
        assert intent.meta.cooldown_seconds == 900.0  # 15m

    def test_compile_type(self):
        graph = compile(TYPE_DECL)
        assert "SmartRoom" in graph.types

    def test_confidence_decay(self):
        src = """
        node @s :: Sensor {
          value = 1.0
          ~confidence 1.0
          ~valid 2026-01-01T00:00Z .. *
          ~decay 0.5 / 1h
        }
        """
        graph = compile(src)
        node = graph.nodes["s"]
        # Compute effective confidence 2 hours after valid_start
        t = datetime(2026, 1, 1, 2, 0, 0, tzinfo=timezone.utc)
        eff = node.meta.effective_confidence(at_time=t)
        assert abs(eff - 0.25) < 0.001  # 1.0 * 0.5^2 = 0.25


# ── Query tests ───────────────────────────────────────────────────────────────

class TestGraph:
    def _make_graph(self) -> KNDLGraph:
        src = """
        node @t1 :: Temperature {
          value = 22.5
          unit  = "°C"
          ~confidence 0.9
          ~source "sensor://a"
        }
        node @t2 :: Temperature {
          value = 30.0
          unit  = "°C"
          ~confidence 0.4
          ~source "sensor://b"
        }
        node @r1 :: Room {
          name = "Meeting Room 204"
        }
        edge @t1 -[located_in]-> @r1
        """
        return compile(src)

    def test_query_by_type(self):
        graph = self._make_graph()
        nodes = graph.query_nodes(type_name="Temperature")
        assert len(nodes) == 2

    def test_query_by_confidence(self):
        graph = self._make_graph()
        nodes = graph.query_nodes(type_name="Temperature", min_confidence=0.8)
        assert len(nodes) == 1
        assert nodes[0].id == "t1"

    def test_query_by_field(self):
        graph = self._make_graph()
        nodes = graph.query_nodes(field_filters={"unit": "°C"})
        assert len(nodes) == 2

    def test_neighborhood(self):
        graph = self._make_graph()
        result = graph.query_neighborhood("t1", hops=1)
        node_ids = {n["id"] for n in result["nodes"]}
        assert "t1" in node_ids
        assert "r1" in node_ids

    def test_remove_node_cleans_edges(self):
        graph = self._make_graph()
        initial_edges = len(graph.edges)
        graph.remove_node("t1")
        assert "t1" not in graph.nodes
        # The edge t1 -[located_in]-> r1 should be gone
        assert len(graph.edges) < initial_edges

    def test_update_node(self):
        graph = self._make_graph()
        graph.update_node("t1", fields={"value": 25.0})
        assert graph.nodes["t1"].fields["value"] == 25.0

    def test_to_dict_roundtrip(self):
        graph = self._make_graph()
        d = graph.to_dict()
        assert d["summary"]["node_count"] == 3
        assert d["summary"]["edge_count"] >= 1


# ── Serializer tests ──────────────────────────────────────────────────────────

class TestSerializer:
    def test_serialize_node(self):
        graph = compile(SIMPLE_NODE)
        text = serialize(graph)
        assert "node @sensor_01" in text
        assert ":: Temperature" in text
        assert "~confidence" in text
        assert "~source" in text

    def test_serialize_edge(self):
        src = "edge @a -[linked_to]-> @b"
        graph = compile(src)
        text = serialize(graph)
        assert "edge" in text
        assert "linked_to" in text

    def test_serialize_preserves_confidence(self):
        graph = compile(SIMPLE_NODE)
        text = serialize(graph)
        assert "0.94" in text

    def test_roundtrip(self):
        """Parse → compile → serialize → parse again → same graph size."""
        graph1 = compile(SIMPLE_NODE)
        text = serialize(graph1)
        graph2 = compile(text)
        assert len(graph1.nodes) == len(graph2.nodes)
