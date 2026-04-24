"""Tests for KNDL v0.2 features."""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from kndl import parse, compile, serialize, tokenize
from kndl.lexer import TokenType
from kndl.graph import KNDLMeta


# ─────────────────────────────────────────────
# Lexer tests
# ─────────────────────────────────────────────

class TestLexerV02:
    def test_decimal_literal(self):
        """19.99d tokenizes as DECIMAL."""
        tokens = tokenize("19.99d")
        assert tokens[0].type == TokenType.DECIMAL
        assert tokens[0].value == "19.99d"

    def test_decimal_literal_small(self):
        """0.0001d tokenizes as DECIMAL."""
        tokens = tokenize("0.0001d")
        assert tokens[0].type == TokenType.DECIMAL
        assert tokens[0].value == "0.0001d"

    def test_duration_ns(self):
        """5ns tokenizes as DURATION."""
        tokens = tokenize("5ns")
        assert tokens[0].type == TokenType.DURATION
        assert tokens[0].value == "5ns"

    def test_duration_us(self):
        """10us tokenizes as DURATION."""
        tokens = tokenize("10us")
        assert tokens[0].type == TokenType.DURATION
        assert tokens[0].value == "10us"

    def test_duration_mo(self):
        """3mo tokenizes as DURATION."""
        tokens = tokenize("3mo")
        assert tokens[0].type == TokenType.DURATION
        assert tokens[0].value == "3mo"

    def test_duration_y(self):
        """2y tokenizes as DURATION."""
        tokens = tokenize("2y")
        assert tokens[0].type == TokenType.DURATION
        assert tokens[0].value == "2y"

    def test_map_open_token(self):
        """#{ tokenizes as MAP_OPEN."""
        tokens = tokenize("#{")
        assert tokens[0].type == TokenType.MAP_OPEN
        assert tokens[0].value == "#{"

    def test_process_keyword(self):
        """'process' tokenizes as KW_PROCESS."""
        tokens = tokenize("process")
        assert tokens[0].type == TokenType.KW_PROCESS

    def test_state_keyword(self):
        """'state' tokenizes as KW_STATE."""
        tokens = tokenize("state")
        assert tokens[0].type == TokenType.KW_STATE

    def test_on_keyword(self):
        """'on' tokenizes as KW_ON."""
        tokens = tokenize("on")
        assert tokens[0].type == TokenType.KW_ON

    def test_by_keyword(self):
        """'by' tokenizes as KW_BY."""
        tokens = tokenize("by")
        assert tokens[0].type == TokenType.KW_BY

    def test_decimal_not_duration_d(self):
        """Float with 'd' suffix is DECIMAL, not DURATION."""
        tokens = tokenize("3.14d")
        assert tokens[0].type == TokenType.DECIMAL

    def test_integer_d_still_duration(self):
        """Integer followed by 'd' remains a DURATION (days)."""
        tokens = tokenize("1d")
        assert tokens[0].type == TokenType.DURATION
        assert tokens[0].value == "1d"

    def test_goto_keyword(self):
        """'goto' tokenizes as KW_GOTO."""
        tokens = tokenize("goto")
        assert tokens[0].type == TokenType.KW_GOTO

    def test_compensate_keyword(self):
        """'compensate' tokenizes as KW_COMPENSATE."""
        tokens = tokenize("compensate")
        assert tokens[0].type == TokenType.KW_COMPENSATE

    def test_of_keyword(self):
        """'of' tokenizes as KW_OF."""
        tokens = tokenize("of")
        assert tokens[0].type == TokenType.KW_OF


# ─────────────────────────────────────────────
# Parser tests
# ─────────────────────────────────────────────

class TestParserV02:
    def test_parse_decimal_field(self):
        """Node with a decimal field value parses correctly."""
        src = """
node @item :: Product {
  price = 19.99d
}
"""
        prog = parse(src)
        assert len(prog.nodes) == 1
        field = prog.nodes[0].fields[0]
        assert field.name == "price"
        # The literal node should have kind "decimal"
        assert field.value.kind == "decimal"
        assert float(field.value.value) == pytest.approx(19.99)

    def test_parse_map_literal(self):
        """Map literal with #{ ... } syntax parses to MapLiteral."""
        src = """
node @cfg :: Config {
  data = #{ "key": "value" }
}
"""
        prog = parse(src)
        field = prog.nodes[0].fields[0]
        from kndl.ast_nodes import MapLiteral
        assert isinstance(field.value, MapLiteral)
        assert len(field.value.pairs) == 1

    def test_parse_process_decl(self):
        """Basic process declaration parses without error."""
        src = """
process @order_flow :: OrderProcess {
}
"""
        prog = parse(src)
        assert len(prog.processes) == 1
        p = prog.processes[0]
        assert p.ref.name == "order_flow"
        assert p.type_name == "OrderProcess"

    def test_parse_process_with_states_and_transitions(self):
        """Process with states and transitions parses correctly."""
        src = """
process @checkout :: CheckoutFlow {
  state pending {}
  state confirmed {}
  on payment_received in pending -> confirmed
}
"""
        prog = parse(src)
        assert len(prog.processes) == 1
        p = prog.processes[0]
        assert len(p.states) == 2
        assert p.states[0].name == "pending"
        assert p.states[1].name == "confirmed"
        assert len(p.transitions) == 1
        t = p.transitions[0]
        assert t.event == "payment_received"
        assert t.from_state == "pending"
        assert t.to_state == "confirmed"

    def test_parse_group_by_query(self):
        """Query with top-level group by clause parses correctly."""
        src = """
query findByType {
  match ?n :: Node
  return ?n
  group by ?n
}
"""
        prog = parse(src)
        assert len(prog.queries) == 1
        q = prog.queries[0]
        assert len(q.group_by) == 1

    def test_parse_reverse_edge(self):
        """Reverse-directed edge <-[T]- parses with direction='reverse'."""
        src = """
edge @b <-[depends_on]- @a
"""
        prog = parse(src)
        assert len(prog.edges) == 1
        e = prog.edges[0]
        assert e.edge_type == "depends_on"
        assert e.direction == "reverse"
        assert e.source.name == "b"
        assert e.targets[0].name == "a"

    def test_parse_process_meta(self):
        """Process declaration with meta-annotations parses correctly."""
        src = """
process @flow :: MyFlow {
  ~confidence 0.9
  state idle {}
}
"""
        prog = parse(src)
        p = prog.processes[0]
        assert len(p.meta) == 1
        assert p.meta[0].key == "confidence"

    def test_parse_multiple_group_by_exprs(self):
        """group by with multiple comma-separated expressions."""
        src = """
query multiGroup {
  match ?n :: Node
  return ?n
  group by ?n, ?n
}
"""
        prog = parse(src)
        q = prog.queries[0]
        assert len(q.group_by) == 2

    def test_parse_map_literal_multiple_pairs(self):
        """Map literal with multiple key-value pairs."""
        src = """
node @cfg :: Config {
  data = #{ "k1": "v1", "k2": "v2" }
}
"""
        prog = parse(src)
        from kndl.ast_nodes import MapLiteral
        field = prog.nodes[0].fields[0]
        assert isinstance(field.value, MapLiteral)
        assert len(field.value.pairs) == 2


# ─────────────────────────────────────────────
# Compiler tests
# ─────────────────────────────────────────────

class TestCompilerV02:
    def test_compile_negated_meta(self):
        """~negated true compiles to meta.negated = True."""
        src = """
node @fact :: Statement {
  ~negated true
}
"""
        graph = compile(src)
        node = graph.get_node("fact")
        assert node is not None
        assert node.meta.negated is True

    def test_compile_recorded_meta(self):
        """~recorded compiles to meta.recorded."""
        src = """
node @obs :: Observation {
  ~recorded "2026-04-22T10:00Z"
}
"""
        graph = compile(src)
        node = graph.get_node("obs")
        assert node.meta.recorded == "2026-04-22T10:00Z"

    def test_compile_observed_meta(self):
        """~observed compiles to meta.observed."""
        src = """
node @sensor_r :: Reading {
  ~observed "2026-04-22T09:00Z"
}
"""
        graph = compile(src)
        node = graph.get_node("sensor_r")
        assert node.meta.observed == "2026-04-22T09:00Z"

    def test_compile_deadline_meta(self):
        """~deadline compiles to meta.deadline."""
        src = """
node @task1 :: Task {
  ~deadline "2026-05-01"
}
"""
        graph = compile(src)
        node = graph.get_node("task1")
        assert node.meta.deadline == "2026-05-01"

    def test_compile_classification_meta(self):
        """~classification compiles to meta.classification."""
        src = """
node @doc1 :: Document {
  ~classification "confidential"
}
"""
        graph = compile(src)
        node = graph.get_node("doc1")
        assert node.meta.classification == "confidential"

    def test_compile_process(self):
        """Process declaration compiles into graph.processes."""
        src = """
process @order_flow :: OrderProcess {
}
"""
        graph = compile(src)
        assert "order_flow" in graph.processes
        p = graph.processes["order_flow"]
        assert p["type"] == "OrderProcess"

    def test_compile_process_states(self):
        """Process states compile into the processes dict."""
        src = """
process @checkout :: CheckoutFlow {
  state pending {}
  state confirmed {}
}
"""
        graph = compile(src)
        p = graph.processes["checkout"]
        assert len(p["states"]) == 2
        state_names = [s["name"] for s in p["states"]]
        assert "pending" in state_names
        assert "confirmed" in state_names

    def test_compile_process_transitions(self):
        """Process transitions compile correctly."""
        src = """
process @checkout :: CheckoutFlow {
  state pending {}
  state confirmed {}
  on payment_received in pending -> confirmed
}
"""
        graph = compile(src)
        p = graph.processes["checkout"]
        assert len(p["transitions"]) == 1
        t = p["transitions"][0]
        assert t["event"] == "payment_received"
        assert t["from"] == "pending"
        assert t["to"] == "confirmed"

    def test_compile_process_in_graph(self):
        """Compiled process appears in graph.to_dict()."""
        src = """
process @flow1 :: MyFlow {
  state initial {}
}
"""
        graph = compile(src)
        d = graph.to_dict()
        assert "processes" in d
        assert "flow1" in d["processes"]

    def test_compile_negated_false_by_default(self):
        """meta.negated defaults to False when not set."""
        src = """
node @x :: Thing {}
"""
        graph = compile(src)
        node = graph.get_node("x")
        assert node.meta.negated is False

    def test_compile_retention_meta(self):
        """~retention compiles to meta.retention."""
        src = """
node @log1 :: LogEntry {
  ~retention "90d"
}
"""
        graph = compile(src)
        node = graph.get_node("log1")
        assert node.meta.retention == "90d"


# ─────────────────────────────────────────────
# Serializer tests
# ─────────────────────────────────────────────

class TestSerializerV02:
    def test_serialize_negated_meta(self):
        """Negated meta serializes to ~negated true."""
        meta = KNDLMeta(negated=True)
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert any("~negated" in ln and "true" in ln for ln in lines)

    def test_serialize_recorded_meta(self):
        """Recorded meta serializes to ~recorded."""
        meta = KNDLMeta(recorded="2026-04-22T10:00Z")
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert any("~recorded" in ln for ln in lines)

    def test_serialize_observed_meta(self):
        """Observed meta serializes to ~observed."""
        meta = KNDLMeta(observed="2026-04-22T09:00Z")
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert any("~observed" in ln for ln in lines)

    def test_serialize_deadline_meta(self):
        """Deadline meta serializes to ~deadline."""
        meta = KNDLMeta(deadline="2026-05-01")
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert any("~deadline" in ln for ln in lines)

    def test_serialize_classification_meta(self):
        """Classification meta serializes to ~classification."""
        meta = KNDLMeta(classification="confidential")
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert any("~classification" in ln for ln in lines)

    def test_roundtrip_with_v02_meta(self):
        """Node with v0.2 meta survives a parse → compile → serialize roundtrip."""
        src = """
node @sensor_a :: Reading {
  value = 42
  ~confidence 0.85
  ~recorded "2026-04-22T10:00Z"
  ~negated false
}
"""
        graph = compile(src)
        text = serialize(graph)
        # Reparse and recompile the serialized form
        graph2 = compile(text)
        node = graph2.get_node("sensor_a")
        assert node is not None
        assert node.meta.confidence == pytest.approx(0.85)
        assert node.meta.recorded == "2026-04-22T10:00Z"

    def test_negated_false_not_serialized(self):
        """meta.negated == False does not emit ~negated line."""
        meta = KNDLMeta(negated=False)
        from kndl.serializer import _serialize_meta
        lines = _serialize_meta(meta)
        assert not any("~negated" in ln for ln in lines)

    def test_serialize_v02_meta_to_dict_roundtrip(self):
        """v0.2 meta fields survive to_dict / from_dict roundtrip."""
        meta = KNDLMeta(
            recorded="2026-04-22",
            observed="2026-04-21",
            negated=True,
            deadline="2026-05-01",
            classification="secret",
            retention="30d",
        )
        d = meta.to_dict()
        meta2 = KNDLMeta.from_dict(d)
        assert meta2.recorded == "2026-04-22"
        assert meta2.observed == "2026-04-21"
        assert meta2.negated is True
        assert meta2.deadline == "2026-05-01"
        assert meta2.classification == "secret"
        assert meta2.retention == "30d"


# ─────────────────────────────────────────────
# Version check
# ─────────────────────────────────────────────

class TestVersion:
    def test_version_is_v02(self):
        import kndl
        assert kndl.__version__ == "0.2.0"


# ─────────────────────────────────────────────
# Literal type tests (§2.8, §3.1)
# ─────────────────────────────────────────────

class TestLiteralTypes:
    # ── Bytes (§2.8.11) ──────────────────────

    def test_bytes_token(self):
        tokens = tokenize('b"SGVsbG8="')
        assert tokens[0].type == TokenType.BYTES
        assert tokens[0].value == "SGVsbG8="

    def test_bytes_in_node_field(self):
        src = 'node @n :: T { payload = b"SGVsbG8=" }'
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "bytes"
        assert field.value.value == "SGVsbG8="

    def test_bytes_compile(self):
        src = 'node @n :: T { payload = b"SGVsbG8=" }'
        graph = compile(src)
        assert graph.nodes["n"].fields["payload"] == "SGVsbG8="

    def test_bytes_serialize(self):
        from kndl.serializer import _format_value
        # Bytes are stored as plain strings; serializer wraps in quotes
        assert _format_value("SGVsbG8=") == '"SGVsbG8="'

    # ── Vector (§2.8.12) ─────────────────────

    def test_vector_token(self):
        tokens = tokenize("v[0.12, -0.03, 0.91]")
        assert tokens[0].type == TokenType.VECTOR
        assert tokens[0].value == "0.12, -0.03, 0.91"

    def test_vector_in_node_field(self):
        src = "node @n :: T { embedding = v[0.1, 0.2, 0.3] }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "vector"
        assert field.value.value == pytest.approx([0.1, 0.2, 0.3])

    def test_vector_compile(self):
        src = "node @n :: T { embedding = v[0.1, 0.2, 0.3] }"
        graph = compile(src)
        assert graph.nodes["n"].fields["embedding"] == pytest.approx([0.1, 0.2, 0.3])

    def test_vector_serialize(self):
        from kndl.serializer import _format_value
        assert _format_value([0.1, 0.2, 0.3]) == "v[ 0.1, 0.2, 0.3 ]"

    def test_vector_roundtrip(self):
        src = "node @n :: T { embedding = v[0.5, -0.5, 1.0] }"
        g1 = compile(src)
        text = serialize(g1)
        g2 = compile(text)
        assert g2.nodes["n"].fields["embedding"] == pytest.approx([0.5, -0.5, 1.0])

    # ── Money (§2.8.10) ──────────────────────

    def test_money_token_decimal_plus_code(self):
        tokens = tokenize("19.99d USD")
        assert tokens[0].type == TokenType.DECIMAL
        assert tokens[1].type == TokenType.IDENTIFIER
        assert tokens[1].value == "USD"

    def test_money_literal_parse(self):
        src = "node @n :: T { price = 19.99d USD }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "money"
        assert field.value.value["currency"] == "USD"
        assert field.value.value["amount"] == pytest.approx(19.99)

    def test_money_compile(self):
        src = "node @n :: T { price = 19.99d USD }"
        graph = compile(src)
        price = graph.nodes["n"].fields["price"]
        assert isinstance(price, dict)
        assert price["currency"] == "USD"
        assert price["amount"] == pytest.approx(19.99)

    def test_money_serialize(self):
        from kndl.serializer import _format_value
        result = _format_value({"amount": 19.99, "currency": "EUR"})
        assert "EUR" in result
        assert "19.99" in result

    def test_money_roundtrip(self):
        src = "node @n :: T { price = 100.00d EUR }"
        g1 = compile(src)
        text = serialize(g1)
        g2 = compile(text)
        price = g2.nodes["n"].fields["price"]
        assert price["currency"] == "EUR"
        assert price["amount"] == pytest.approx(100.0)

    def test_decimal_without_currency_stays_decimal(self):
        src = "node @n :: T { rate = 0.05d }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "decimal"

    # ── Quantity (§2.8.9) ────────────────────

    def test_quantity_temperature(self):
        src = "node @n :: T { temp = 22.5 °C }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "quantity"
        assert field.value.value["magnitude"] == pytest.approx(22.5)
        assert field.value.value["unit"] == "°C"

    def test_quantity_compile(self):
        src = "node @sensor :: Reading { value = 22.5 °C }"
        graph = compile(src)
        v = graph.nodes["sensor"].fields["value"]
        assert isinstance(v, dict)
        assert v["unit"] == "°C"
        assert v["magnitude"] == pytest.approx(22.5)

    def test_quantity_integer_magnitude(self):
        src = "node @n :: T { dist = 5 km }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "quantity"
        assert field.value.value["unit"] == "km"

    def test_quantity_composite_unit(self):
        src = "node @n :: T { speed = 5.0 m/s }"
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "quantity"
        assert "m" in field.value.value["unit"]
        assert "s" in field.value.value["unit"]

    def test_quantity_serialize(self):
        from kndl.serializer import _format_value
        result = _format_value({"magnitude": 22.5, "unit": "°C"})
        assert "22.5" in result
        assert "°C" in result

    def test_quantity_roundtrip(self):
        src = "node @n :: T { temp = 22.5 °C }"
        g1 = compile(src)
        text = serialize(g1)
        g2 = compile(text)
        v = g2.nodes["n"].fields["temp"]
        assert v["magnitude"] == pytest.approx(22.5)
        assert v["unit"] == "°C"

    def test_identifier_not_confused_with_quantity_unit(self):
        # 'label' is not a unit atom — field named 'label' after int must not
        # be treated as a quantity unit.
        src = """node @n :: T {
          total = 5
          label = "foo"
        }"""
        graph = compile(src)
        assert graph.nodes["n"].fields["total"] == 5
        assert graph.nodes["n"].fields["label"] == "foo"

    # ── UUID (§3.1 type table) ────────────────

    def test_uuid_token(self):
        tokens = tokenize('u"01890000-0000-0000-0000-000000000001"')
        assert tokens[0].type == TokenType.UUID
        assert "0189" in tokens[0].value

    def test_uuid_in_node_field(self):
        src = 'node @n :: T { id = u"01890000-0000-0000-0000-000000000001" }'
        program = parse(src)
        field = program.nodes[0].fields[0]
        assert field.value.kind == "uuid"
        assert "0189" in field.value.value

    def test_uuid_compile(self):
        src = 'node @n :: T { id = u"01890000-0000-0000-0000-000000000001" }'
        graph = compile(src)
        assert "0189" in graph.nodes["n"].fields["id"]

    # ── Degree-sign lexer edge case ───────────

    def test_degree_symbol_lexes_as_identifier(self):
        tokens = tokenize("°C")
        assert tokens[0].type == TokenType.IDENTIFIER
        assert tokens[0].value == "°C"

    def test_degree_F_lexes_as_identifier(self):
        tokens = tokenize("°F")
        assert tokens[0].type == TokenType.IDENTIFIER
        assert tokens[0].value == "°F"
