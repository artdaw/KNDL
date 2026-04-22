"""
Extended KNDL test suite — additional coverage for edge cases, integration
scenarios, and deeper coverage of the type system, contexts, and serializer.

Run with: pytest
"""

import sys
import os
import pytest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from kndl import parse, compile, serialize, tokenize, LexerError, ParseError
from kndl.lexer import TokenType
from kndl.graph import KNDLGraph, GraphNode, GraphEdge, KNDLMeta


# ── Lexer edge cases ──────────────────────────────────────────────────────────

class TestLexerEdgeCases:
    def test_hex_literal(self):
        tokens = tokenize("0xFF 0x1A 0x00")
        ints = [t for t in tokens if t.type == TokenType.INT]
        assert len(ints) == 3
        assert ints[0].value == "0xFF"

    def test_binary_literal(self):
        tokens = tokenize("0b1010 0b0001")
        ints = [t for t in tokens if t.type == TokenType.INT]
        assert len(ints) == 2
        assert ints[0].value == "0b1010"

    def test_negative_int(self):
        tokens = tokenize("-42")
        ints = [t for t in tokens if t.type == TokenType.INT]
        assert len(ints) == 1

    def test_negative_float(self):
        tokens = tokenize("-3.14")
        floats = [t for t in tokens if t.type == TokenType.FLOAT]
        assert len(floats) == 1

    def test_all_duration_units(self):
        tokens = tokenize("1ms 2s 3m 4h 5d 1w")
        durations = [t for t in tokens if t.type == TokenType.DURATION]
        assert len(durations) == 6
        values = [t.value for t in durations]
        assert "1ms" in values
        assert "2s" in values
        assert "3m" in values
        assert "4h" in values
        assert "5d" in values
        assert "1w" in values

    def test_duration_float_amount(self):
        tokens = tokenize("0.5h")
        durations = [t for t in tokens if t.type == TokenType.DURATION]
        assert len(durations) == 1
        assert durations[0].value == "0.5h"

    def test_unterminated_string_raises(self):
        with pytest.raises(LexerError):
            tokenize('"unterminated')

    def test_nested_block_comment(self):
        tokens = tokenize("/* outer /* inner */ outer end */ node")
        types = [t.type for t in tokens if t.type != TokenType.EOF]
        assert TokenType.KW_NODE in types

    def test_string_with_escape_sequences(self):
        tokens = tokenize(r'"tab\there"')
        assert tokens[0].type == TokenType.STRING
        assert "\t" in tokens[0].value

    def test_boolean_literals(self):
        tokens = tokenize("true false")
        bools = [t for t in tokens if t.type == TokenType.BOOL]
        assert len(bools) == 2

    def test_node_ref_with_dot(self):
        tokens = tokenize("@building.floor_3")
        assert tokens[0].type == TokenType.NODE_REF
        assert tokens[0].value == "@building.floor_3"

    def test_var_bind(self):
        tokens = tokenize("?sensor")
        assert tokens[0].type == TokenType.VAR_BIND

    def test_arrow_variants(self):
        tokens = tokenize("-> <->")
        types = [t.type for t in tokens if t.type != TokenType.EOF]
        assert TokenType.OP_ARROW in types
        assert TokenType.OP_BIARROW in types

    def test_operator_precedence_tokens(self):
        tokens = tokenize("== != >= <=")
        types = [t.type for t in tokens if t.type != TokenType.EOF]
        assert TokenType.OP_EQ in types
        assert TokenType.OP_NEQ in types
        assert TokenType.OP_GTE in types
        assert TokenType.OP_LTE in types

    def test_large_float_exponent(self):
        tokens = tokenize("1.5e10 2.0E-3")
        floats = [t for t in tokens if t.type == TokenType.FLOAT]
        assert len(floats) == 2

    def test_underscore_separator_in_int(self):
        tokens = tokenize("1_000_000")
        ints = [t for t in tokens if t.type == TokenType.INT]
        assert len(ints) == 1


# ── Parser extended tests ─────────────────────────────────────────────────────

class TestParserExtended:
    def test_parse_constrained_type(self):
        # Constraints live in TypeDecl.constraints, not TypeExpr.kind
        src = "type ValidTemp = Float where { value >= -50 and value <= 150 }"
        program = parse(src)
        assert len(program.types) == 1
        assert len(program.types[0].constraints) > 0

    def test_parse_export_declaration(self):
        # Parser supports `export <decl>` — not `export { names }`
        src = "export type SmartRoom { name : String }"
        program = parse(src)
        assert len(program.exports) == 1

    def test_parse_multi_field_node(self):
        src = """node @sensor :: Sensor {
          id      = "S-001"
          active  = true
          floor   = 3
          rating  = 4.5
        }"""
        program = parse(src)
        node = program.nodes[0]
        fields = {f.name: f for f in node.fields}
        assert "id" in fields
        assert "active" in fields
        assert "floor" in fields
        assert "rating" in fields

    def test_parse_context_with_edges(self):
        src = """context @building {
          ~source "system://dt"
          node @floor_1 :: Floor { level = 1 }
          node @floor_2 :: Floor { level = 2 }
          edge @floor_1 -[above]-> @floor_2
        }"""
        program = parse(src)
        ctx = program.contexts[0]
        assert len(ctx.nodes) == 2
        assert len(ctx.edges) == 1

    def test_parse_query_with_aggregation(self):
        # aggregate clause lives after return expression, in { } block
        src = """query avg_temp {
          match ?s :: Temperature
          where ?s.value > 0
          return ?s aggregate { mean_temp = avg(?s.value) }
        }"""
        program = parse(src)
        assert len(program.queries) == 1

    def test_parse_optional_match_in_query(self):
        # optional keyword precedes match keyword; avoid `in` (reserved keyword)
        src = """query rooms {
          match ?room :: Room
          optional match ?sensor :: Sensor -[located_in]-> ?room
          return ?room
        }"""
        program = parse(src)
        assert program.queries[0].name == "rooms"

    def test_parse_query_trigger_intent(self):
        # trigger = query <inline_query_decl>
        src = """intent @check :: Monitor {
          trigger = query hot_rooms {
            match ?s :: Temperature
            where ?s.value > 30
            return ?s
          }
          do { emit :: Alert { level = "warn" } }
        }"""
        program = parse(src)
        assert program.intents[0].trigger.kind == "query"

    def test_parse_type_struct_with_optional_fields(self):
        src = """type Building {
          name     : String
          floors   : Int
          manager  : Person?
        }"""
        program = parse(src)
        fields = program.types[0].fields
        optional_field = next(f for f in fields if f.name == "manager")
        assert optional_field.type_expr.kind == "optional"

    def test_parse_nested_context(self):
        src = """context @campus {
          ~source "system://campus"
          context @building_7 {
            ~source "system://bldg7"
            node @room_204 :: Room { name = "204" }
          }
        }"""
        program = parse(src)
        assert len(program.contexts) == 1
        outer = program.contexts[0]
        assert len(outer.contexts) == 1

    def test_parse_error_missing_closing_brace(self):
        with pytest.raises(ParseError):
            parse("node @x :: Foo { val = 1")

    def test_parse_multi_target_edge_with_meta(self):
        src = """edge @hub -[connects]-> [ @a, @b, @c ] {
          ~confidence 0.9
        }"""
        program = parse(src)
        edge = program.edges[0]
        assert len(edge.targets) == 3
        assert len(edge.meta) == 1


# ── Compiler extended tests ───────────────────────────────────────────────────

class TestCompilerExtended:
    def test_compile_multiple_nodes(self):
        src = """
        node @a :: Person { name = "Alice" }
        node @b :: Person { name = "Bob" }
        node @c :: Location { name = "Office" }
        """
        graph = compile(src)
        assert len(graph.nodes) == 3
        assert "a" in graph.nodes
        assert "b" in graph.nodes
        assert "c" in graph.nodes

    def test_compile_edge_creates_both_node_refs(self):
        src = """
        node @alice :: Person { name = "Alice" }
        node @lab :: Organization { name = "Lab" }
        edge @alice -[works_at]-> @lab { ~confidence 0.98 }
        """
        graph = compile(src)
        edges = graph.get_outgoing_edges("alice")
        assert len(edges) == 1
        assert edges[0].target_id == "lab"
        assert edges[0].meta.confidence == 0.98

    def test_compile_standalone_edge_with_fields(self):
        src = """
        edge @a -[links]-> @b {
          ~confidence 0.7
          ~source "agent://linker"
        }
        """
        graph = compile(src)
        edge = next(iter(graph.edges.values()))
        assert edge.meta.confidence == 0.7
        assert edge.meta.source == "agent://linker"

    def test_compile_context_with_multiple_nodes(self):
        src = """
        context @site {
          ~source "system://site"
          ~confidence 0.85
          node @a :: Floor { level = 1 }
          node @b :: Floor { level = 2 }
          node @c :: Floor { level = 3 }
        }
        """
        graph = compile(src)
        for node_id in ("a", "b", "c"):
            assert graph.nodes[node_id].meta.source == "system://site"
            assert graph.nodes[node_id].meta.confidence == 0.85

    def test_compile_context_node_confidence_override(self):
        src = """
        context @site {
          ~confidence 0.5
          node @special :: Room {
            name = "VIP"
            ~confidence 0.99
          }
        }
        """
        graph = compile(src)
        assert graph.nodes["special"].meta.confidence == 0.99

    def test_compile_tags_on_node(self):
        src = """
        node @sensor :: Sensor {
          ~tags ["iot", "outdoor", "v2"]
        }
        """
        graph = compile(src)
        assert "iot" in graph.nodes["sensor"].meta.tags
        assert "outdoor" in graph.nodes["sensor"].meta.tags

    def test_compile_decay_all_units(self):
        for dur, expected in [("1s", 1.0), ("5m", 300.0), ("2h", 7200.0), ("1d", 86400.0)]:
            src = f"""
            node @x :: Sensor {{
              ~confidence 1.0
              ~decay 0.9 / {dur}
            }}
            """
            graph = compile(src)
            assert graph.nodes["x"].meta.decay_duration_seconds == expected

    def test_compile_type_struct(self):
        src = """
        type SmartSensor {
          temp   : Float
          unit   : String
          active : Bool
        }
        """
        graph = compile(src)
        assert "SmartSensor" in graph.types

    def test_compile_intent_with_emit(self):
        src = """
        intent @alert :: Action {
          trigger = @sensor.value > 40
          do { emit :: HeatAlert { level = "high" } }
          ~priority 0.95
          ~cooldown 5m
        }
        """
        graph = compile(src)
        intent = graph.intents["alert"]
        assert intent.type_name == "Action"
        assert intent.meta.cooldown_seconds == 300.0  # 5m
        assert intent.meta.priority == 0.95

    def test_compile_valid_range_with_end(self):
        src = """
        node @event :: Event {
          ~valid 2026-01-01T00:00Z .. 2026-12-31T23:59Z
        }
        """
        graph = compile(src)
        node = graph.nodes["event"]
        assert node.meta.valid_start == "2026-01-01T00:00Z"
        assert node.meta.valid_end == "2026-12-31T23:59Z"

    def test_compile_supersedes(self):
        src = """
        node @reading_v2 :: Temperature {
          value = 22.0
          ~supersedes "reading_v1"
        }
        """
        graph = compile(src)
        assert graph.nodes["reading_v2"].meta.supersedes == "reading_v1"


# ── Graph extended tests ──────────────────────────────────────────────────────

class TestGraphExtended:
    def _make_graph(self) -> KNDLGraph:
        src = """
        node @t1 :: Temperature { value = 22.5 ~confidence 0.9 }
        node @t2 :: Temperature { value = 30.0 ~confidence 0.4 }
        node @r1 :: Room        { name = "Lab" }
        node @b1 :: Building    { name = "HQ"  }
        edge @t1 -[in_room]->   @r1
        edge @r1 -[in_building]-> @b1
        """
        return compile(src)

    def test_two_hop_neighborhood(self):
        graph = self._make_graph()
        result = graph.query_neighborhood("t1", hops=2)
        ids = {n["id"] for n in result["nodes"]}
        assert "t1" in ids
        assert "r1" in ids
        assert "b1" in ids  # reached via 2 hops

    def test_one_hop_neighborhood_excludes_distant(self):
        graph = self._make_graph()
        result = graph.query_neighborhood("t1", hops=1)
        ids = {n["id"] for n in result["nodes"]}
        assert "b1" not in ids

    def test_get_incoming_edges(self):
        graph = self._make_graph()
        incoming = graph.get_incoming_edges("r1")
        assert any(e.source_id == "t1" for e in incoming)

    def test_get_outgoing_edges(self):
        graph = self._make_graph()
        outgoing = graph.get_outgoing_edges("r1")
        assert any(e.target_id == "b1" for e in outgoing)

    def test_update_node_meta(self):
        graph = self._make_graph()
        graph.update_node("t1", meta_updates={"confidence": 0.75})
        assert graph.nodes["t1"].meta.confidence == 0.75

    def test_add_and_query_node(self):
        graph = KNDLGraph()
        meta = KNDLMeta(confidence=0.9, source="test://unit")
        node = GraphNode(id="n1", type_name="Widget", fields={"x": 1}, meta=meta)
        graph.add_node(node)
        results = graph.query_nodes(type_name="Widget")
        assert len(results) == 1
        assert results[0].id == "n1"

    def test_add_edge_and_query(self):
        graph = KNDLGraph()
        meta = KNDLMeta(confidence=1.0)
        graph.add_node(GraphNode(id="a", type_name="T", fields={}, meta=KNDLMeta()))
        graph.add_node(GraphNode(id="b", type_name="T", fields={}, meta=KNDLMeta()))
        edge = GraphEdge(source_id="a", target_id="b", edge_type="links", fields={}, meta=meta)
        graph.add_edge(edge)
        outgoing = graph.get_outgoing_edges("a")
        assert len(outgoing) == 1
        assert outgoing[0].target_id == "b"

    def test_remove_node_removes_all_edges(self):
        graph = self._make_graph()
        # r1 has both incoming (t1) and outgoing (b1) edges
        graph.remove_node("r1")
        assert "r1" not in graph.nodes
        remaining_edges = list(graph.edges.values())
        for e in remaining_edges:
            assert e.source_id != "r1" and e.target_id != "r1"

    def test_from_dict_roundtrip(self):
        graph = self._make_graph()
        d = graph.to_dict()
        graph2 = KNDLGraph.from_dict(d)
        assert len(graph2.nodes) == len(graph.nodes)
        assert len(graph2.edges) == len(graph.edges)

    def test_query_by_field_filter(self):
        graph = self._make_graph()
        results = graph.query_nodes(field_filters={"name": "Lab"})
        assert len(results) == 1
        assert results[0].id == "r1"

    def test_query_all_nodes_no_filter(self):
        graph = self._make_graph()
        all_nodes = graph.query_nodes()
        assert len(all_nodes) == 4

    def test_effective_confidence_no_decay(self):
        node_meta = KNDLMeta(confidence=0.8)
        assert node_meta.effective_confidence() == 0.8

    def test_effective_confidence_with_decay(self):
        node_meta = KNDLMeta(
            confidence=1.0,
            valid_start="2026-01-01T00:00Z",
            decay_rate=0.5,
            decay_duration_seconds=3600.0,  # 1h
        )
        at = datetime(2026, 1, 1, 3, 0, 0, tzinfo=timezone.utc)  # 3 hours later
        eff = node_meta.effective_confidence(at_time=at)
        assert abs(eff - 0.125) < 0.001  # 1.0 * 0.5^3


# ── Serializer extended tests ─────────────────────────────────────────────────

class TestSerializerExtended:
    def test_serialize_multi_node_graph(self):
        src = """
        node @alice :: Person { name = "Alice" ~confidence 0.9 }
        node @bob   :: Person { name = "Bob"   ~confidence 0.8 }
        """
        graph = compile(src)
        text = serialize(graph)
        assert "node @alice" in text
        assert "node @bob" in text

    def test_serialize_edge_with_confidence(self):
        src = """
        edge @a -[links]-> @b { ~confidence 0.75 ~source "agent://linker" }
        """
        graph = compile(src)
        text = serialize(graph)
        assert "edge" in text
        assert "links" in text
        assert "0.75" in text

    def test_roundtrip_preserves_edge_count(self):
        src = """
        node @a :: T { ~confidence 0.9 }
        node @b :: T { ~confidence 0.8 }
        node @c :: T { ~confidence 0.7 }
        edge @a -[x]-> @b
        edge @b -[x]-> @c
        edge @a -[x]-> @c
        """
        g1 = compile(src)
        text = serialize(g1)
        g2 = compile(text)
        assert len(g1.edges) == len(g2.edges)

    def test_roundtrip_preserves_meta_decay(self):
        src = """
        node @sensor :: Sensor {
          ~confidence 0.95
          ~decay 0.8 / 30m
        }
        """
        g1 = compile(src)
        text = serialize(g1)
        g2 = compile(text)
        n = g2.nodes["sensor"]
        assert n.meta.decay_rate == 0.8
        assert n.meta.decay_duration_seconds == 1800.0  # 30m

    def test_serialize_tags(self):
        src = """
        node @sensor :: Sensor { ~tags ["iot", "v2"] }
        """
        graph = compile(src)
        text = serialize(graph)
        assert "iot" in text

    def test_serialize_valid_range(self):
        src = """
        node @event :: Event {
          ~valid 2026-01-01T00:00Z .. 2026-12-31T23:59Z
        }
        """
        graph = compile(src)
        text = serialize(graph)
        assert "2026-01-01T00:00Z" in text


# ── Integration tests ─────────────────────────────────────────────────────────

class TestIntegration:
    FULL_DOC = """
    // Smart building IoT scenario
    type SmartRoom {
      name  : String
      floor : Int
    }

    context @campus {
      ~source "system://dt"
      ~confidence 0.95

      node @building_7 :: Building {
        name   = "HQ"
        floors = 5
        ~confidence 0.99
      }

      node @floor_3 :: Floor {
        level  = 3
        above  -> @floor_2
        ~confidence 0.97
      }

      node @floor_2 :: Floor {
        level  = 2
      }
    }

    node @temp_001 :: Temperature {
      value    = 21.5
      unit     = "°C"
      location -> @floor_3
      ~confidence 0.93
      ~source     "sensor://bldg7/f3/t001"
      ~valid      2026-04-10T14:00Z .. *
      ~decay      0.95 / 1h
    }

    edge @temp_001 -[monitors]-> @building_7 {
      ~confidence 0.9
    }

    intent @overheat :: Alert {
      trigger = @temp_001.value > 30.0
      do { emit :: HeatAlert { level = "critical" } }
      ~priority 0.95
      ~cooldown 15m
    }

    import { StandardUnits } from "kndl://std/units"
    export type SmartRoom { name : String }
    """

    def test_compile_full_document(self):
        graph = compile(self.FULL_DOC)
        assert "building_7" in graph.nodes
        assert "floor_3" in graph.nodes
        assert "temp_001" in graph.nodes

    def test_context_meta_inherited(self):
        graph = compile(self.FULL_DOC)
        assert graph.nodes["building_7"].meta.confidence == 0.99
        assert graph.nodes["floor_3"].meta.source == "system://dt"

    def test_standalone_edge_in_full_doc(self):
        graph = compile(self.FULL_DOC)
        edges = graph.get_outgoing_edges("temp_001")
        types = {e.edge_type for e in edges}
        assert "monitors" in types or "location" in types

    def test_intent_compiled(self):
        graph = compile(self.FULL_DOC)
        assert "overheat" in graph.intents
        intent = graph.intents["overheat"]
        assert intent.meta.cooldown_seconds == 900.0

    def test_type_compiled(self):
        graph = compile(self.FULL_DOC)
        assert "SmartRoom" in graph.types

    def test_full_roundtrip(self):
        graph1 = compile(self.FULL_DOC)
        text = serialize(graph1)
        graph2 = compile(text)
        assert len(graph1.nodes) == len(graph2.nodes)
        assert "temp_001" in graph2.nodes

    def test_graph_stats_via_dict(self):
        graph = compile(self.FULL_DOC)
        d = graph.to_dict()
        assert d["summary"]["node_count"] >= 3

    def test_neighborhood_across_context_boundary(self):
        graph = compile(self.FULL_DOC)
        result = graph.query_neighborhood("temp_001", hops=2)
        ids = {n["id"] for n in result["nodes"]}
        assert "temp_001" in ids
        assert "floor_3" in ids
