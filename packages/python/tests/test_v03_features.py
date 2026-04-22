"""Tests for newly implemented KNDL v0.2 features (second wave)."""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from kndl import parse, compile, serialize


# ─────────────────────────────────────────────────────────────────────────────
# §3: Parameterised types  Type<Param>
# ─────────────────────────────────────────────────────────────────────────────

class TestParameterisedTypes:
    def test_simple_param(self):
        """type Temperature = Quantity<°C> parses correctly."""
        src = 'type Temperature = Quantity<°C>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "parameterised"
        assert te.name == "Quantity"
        assert len(te.params) == 1
        assert te.params[0].name == "°C"

    def test_string_param(self):
        """type ICD10Code = Code<"ICD-10"> parses string param."""
        src = 'type ICD10Code = Code<"ICD-10">'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "parameterised"
        assert te.name == "Code"
        assert te.params[0].kind == "literal"
        assert te.params[0].name == "ICD-10"

    def test_multi_params(self):
        """Localized<string, en> parses two params."""
        src = 'type LocalStr = Localized<string, en>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "parameterised"
        assert len(te.params) == 2
        assert te.params[0].name == "string"
        assert te.params[1].name == "en"

    def test_nested_param(self):
        """Distribution<Gaussian> — nested parameterised type."""
        src = 'type DistNode = Distribution<Gaussian>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "parameterised"
        assert te.params[0].name == "Gaussian"

    def test_optional_param(self):
        """Vector<float>? — optional parameterised type."""
        src = 'type MaybeVec = Vector<float>?'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "optional"
        inner = te.children[0]
        assert inner.kind == "parameterised"
        assert inner.name == "Vector"

    def test_compile_type_with_param(self):
        """type decl with param compiles without error."""
        src = 'type Reading = Quantity<°C>'
        g = compile(src)
        assert "Reading" in g.types

    def test_param_in_field_decl(self):
        """Field declarations with parameterised types parse."""
        src = """type Sensor {
            reading: Quantity<°C>
            label: Localized<string>
        }"""
        prog = parse(src)
        fields = prog.types[0].fields
        assert fields[0].type_expr.kind == "parameterised"
        assert fields[0].type_expr.name == "Quantity"
        assert fields[1].type_expr.kind == "parameterised"
        assert fields[1].type_expr.name == "Localized"


# ─────────────────────────────────────────────────────────────────────────────
# §5.2: Multi-hop path patterns   -[T*1..5]->
# ─────────────────────────────────────────────────────────────────────────────

class TestMultiHopPatterns:
    def test_unbounded_star(self):
        """-[knows*]-> means 1..∞ hops."""
        src = """query { match ?a :: Person -[knows*]-> ?b :: Person return ?b }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.edge_type == "knows"
        assert ep.hop_min == 1
        assert ep.hop_max == -1

    def test_exact_hops(self):
        """-[knows*2]-> means exactly 2 hops."""
        src = """query { match ?a :: Person -[knows*2]-> ?b :: Person return ?b }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.hop_min == 2
        assert ep.hop_max == 2

    def test_range_hops(self):
        """-[knows*1..5]-> means 1 to 5 hops."""
        src = """query { match ?a :: Person -[knows*1..5]-> ?b :: Person return ?b }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.hop_min == 1
        assert ep.hop_max == 5

    def test_lower_bound_only(self):
        """-[knows*2..]-> means 2 to unbounded."""
        src = """query { match ?a :: Person -[knows*2..]-> ?b :: Person return ?b }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.hop_min == 2
        assert ep.hop_max == -1

    def test_single_hop_default(self):
        """-[knows]-> without * means 1 hop."""
        src = """query { match ?a :: Person -[knows]-> ?b :: Person return ?b }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.hop_min == 1
        assert ep.hop_max == 1

    def test_multi_hop_with_type(self):
        """-[located_in*1..3]-> with meaningful edge type."""
        src = """query { match ?place :: Location -[located_in*1..3]-> ?region :: Region return ?region }"""
        prog = parse(src)
        ep = prog.queries[0].matches[0].edge_pattern
        assert ep.edge_type == "located_in"
        assert ep.hop_min == 1
        assert ep.hop_max == 3


# ─────────────────────────────────────────────────────────────────────────────
# Undirected typed edge   -[T]-
# ─────────────────────────────────────────────────────────────────────────────

class TestUndirectedEdge:
    def test_undirected_edge_parses(self):
        """edge @a -[related_to]- @b is undirected."""
        src = "edge @a -[related_to]- @b"
        prog = parse(src)
        e = prog.edges[0]
        assert e.edge_type == "related_to"
        assert e.direction == "undirected"

    def test_undirected_edge_compiles(self):
        """Undirected edge compiles to a GraphEdge with direction='undirected'."""
        src = """
        node @a :: T {}
        node @b :: T {}
        edge @a -[peer_of]- @b
        """
        g = compile(src)
        edges = list(g.edges.values())
        assert any(e.direction == "undirected" and e.edge_type == "peer_of" for e in edges)

    def test_undirected_vs_forward(self):
        """Undirected -[T]- is distinct from forward -[T]->."""
        src = """
        node @a :: T {}
        node @b :: T {}
        edge @a -[connected]- @b
        edge @a -[links_to]-> @b
        """
        g = compile(src)
        edges = list(g.edges.values())
        directions = {e.edge_type: e.direction for e in edges}
        assert directions["connected"] == "undirected"
        assert directions["links_to"] == "forward"

    def test_undirected_with_body(self):
        """Undirected edge with meta block."""
        src = """
        node @a :: T {}
        node @b :: T {}
        edge @a -[peer_of]- @b {
            ~confidence 0.9
        }
        """
        g = compile(src)
        edges = list(g.edges.values())
        e = next(e for e in edges if e.edge_type == "peer_of")
        assert e.direction == "undirected"
        assert e.meta.confidence == pytest.approx(0.9)


# ─────────────────────────────────────────────────────────────────────────────
# Named struct literal   TypeName { key = value }
# (used for ~uncertainty and other compound meta values)
# ─────────────────────────────────────────────────────────────────────────────

class TestNamedStructLiteral:
    def test_uncertainty_gaussian_parses(self):
        """~uncertainty gaussian { mean = 0.5, std = 0.1 } parses as MapLiteral."""
        from kndl.ast_nodes import MapLiteral
        src = """node @n :: T {
          ~uncertainty gaussian { mean = 0.5, std = 0.1 }
        }"""
        prog = parse(src)
        meta = prog.nodes[0].meta[0]
        assert meta.key == "uncertainty"
        assert isinstance(meta.value, MapLiteral)

    def test_uncertainty_gaussian_compile(self):
        """~uncertainty gaussian { ... } compiles to KNDLMeta.uncertainty dict."""
        src = """node @n :: T {
          ~uncertainty gaussian { mean = 0.5, std = 0.1 }
        }"""
        g = compile(src)
        u = g.nodes["n"].meta.uncertainty
        assert u is not None
        assert u.get("_type") == "gaussian"
        assert u.get("mean") == pytest.approx(0.5)
        assert u.get("std") == pytest.approx(0.1)

    def test_uncertainty_interval(self):
        """~uncertainty interval { low = 0.0, high = 1.0 } compiles."""
        src = """node @n :: T {
          ~uncertainty interval { low = 0.0, high = 1.0 }
        }"""
        g = compile(src)
        u = g.nodes["n"].meta.uncertainty
        assert u["_type"] == "interval"
        assert u["low"] == pytest.approx(0.0)
        assert u["high"] == pytest.approx(1.0)

    def test_uncertainty_categorical(self):
        """~uncertainty categorical { A = 0.3, B = 0.7 } compiles."""
        src = """node @n :: T {
          ~uncertainty categorical { A = 0.3, B = 0.7 }
        }"""
        g = compile(src)
        u = g.nodes["n"].meta.uncertainty
        assert u["_type"] == "categorical"
        assert u["A"] == pytest.approx(0.3)
        assert u["B"] == pytest.approx(0.7)

    def test_uncertainty_serializes(self):
        """~uncertainty gaussian block round-trips through the serializer."""
        src = """node @n :: T {
          ~uncertainty gaussian { mean = 0.5, std = 0.1 }
        }"""
        g = compile(src)
        text = serialize(g)
        assert "~uncertainty" in text
        assert "gaussian" in text

    def test_named_struct_in_field(self):
        """TypeName { ... } in a field value compiles to a dict."""
        src = """node @n :: T {
          dist = Gaussian { mean = 0.0, std = 1.0 }
        }"""
        g = compile(src)
        d = g.nodes["n"].fields["dist"]
        assert isinstance(d, dict)
        assert d.get("_type") == "Gaussian"
        assert d.get("mean") == pytest.approx(0.0)


# ─────────────────────────────────────────────────────────────────────────────
# §6: goto action in process transitions
# ─────────────────────────────────────────────────────────────────────────────

class TestGotoAction:
    def test_goto_parses(self):
        """goto STATE_NAME parses as EmitAction with action_type='goto'."""
        src = """process @order :: OrderProcess {
          state PENDING {}
          state APPROVED {}
          on approve in PENDING -> APPROVED do {
            goto APPROVED
          }
        }"""
        prog = parse(src)
        td = prog.processes[0].transitions[0]
        goto_actions = [a for a in td.actions if a.action_type == "goto"]
        assert len(goto_actions) == 1
        assert goto_actions[0].goto_state == "APPROVED"

    def test_goto_with_emit(self):
        """goto can coexist with emit actions."""
        src = """process @order :: OrderProcess {
          state PENDING {}
          state REVIEWING {}
          on submit in PENDING -> REVIEWING do {
            emit :: ReviewTask { priority = 1 }
            goto REVIEWING
          }
        }"""
        prog = parse(src)
        td = prog.processes[0].transitions[0]
        assert any(a.action_type == "create" for a in td.actions)
        assert any(a.action_type == "goto" for a in td.actions)

    def test_goto_compiles(self):
        """Process with goto compiles without error."""
        src = """process @order :: OrderProcess {
          state PENDING {}
          state DONE {}
          on complete in PENDING -> DONE do {
            goto DONE
          }
        }"""
        g = compile(src)
        assert "order" in g.processes


# ─────────────────────────────────────────────────────────────────────────────
# §9: Uncertainty model — meta field round-trip
# ─────────────────────────────────────────────────────────────────────────────

class TestUncertaintyModel:
    def test_uncertainty_in_meta_dict(self):
        """KNDLMeta.uncertainty survives to_dict/from_dict round-trip."""
        from kndl.graph import KNDLMeta
        m = KNDLMeta(uncertainty={"_type": "gaussian", "mean": 0.5, "std": 0.1})
        d = m.to_dict()
        assert "uncertainty" in d
        m2 = KNDLMeta.from_dict(d)
        assert m2.uncertainty["_type"] == "gaussian"
        assert m2.uncertainty["mean"] == pytest.approx(0.5)

    def test_uncertainty_none_not_in_dict(self):
        """uncertainty=None should not appear in to_dict output."""
        from kndl.graph import KNDLMeta
        m = KNDLMeta()
        d = m.to_dict()
        assert "uncertainty" not in d

    def test_uncertainty_histogram(self):
        """~uncertainty histogram with named buckets compiles."""
        src = """node @n :: T {
          ~uncertainty histogram { p0_25 = 0.1, p0_75 = 0.8, p1_0 = 1.0 }
        }"""
        g = compile(src)
        u = g.nodes["n"].meta.uncertainty
        assert u["_type"] == "histogram"
        assert "p0_25" in u


# ─────────────────────────────────────────────────────────────────────────────
# Additional parameterised type edge cases
# ─────────────────────────────────────────────────────────────────────────────

class TestParameterisedTypeEdgeCases:
    def test_union_of_parameterised(self):
        """Quantity<m> | Quantity<km> parses as union of two parameterised types."""
        src = 'type Distance = Quantity<m> | Quantity<km>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "union"
        assert te.children[0].kind == "parameterised"
        assert te.children[1].kind == "parameterised"

    def test_intersection_parameterised(self):
        """Code<ICD10> & Localized<string> parses as intersection."""
        src = 'type MedCode = Code<ICD10> & Localized<string>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "intersection"

    def test_deeply_nested_type(self):
        """Distribution<Gaussian<float>> — deeply nested."""
        src = 'type D = Distribution<Gaussian<float>>'
        prog = parse(src)
        te = prog.types[0].type_expr
        assert te.kind == "parameterised"
        assert te.params[0].kind == "parameterised"
        assert te.params[0].params[0].name == "float"
