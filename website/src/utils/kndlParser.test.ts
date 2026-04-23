import { describe, it, expect } from "vitest";
import { parseKNDL, typeColor, TYPE_COLORS } from "./kndlParser";

// ── parseKNDL ─────────────────────────────────────────────────────────────────

describe("parseKNDL", () => {
  it("parses a single node with fields", () => {
    const g = parseKNDL(`node @sensor_01 :: Temperature {
  value = 22.5
  unit  = "°C"
}`);
    expect(g.nodes["sensor_01"]).toBeDefined();
    expect(g.nodes["sensor_01"].typeName).toBe("Temperature");
    expect(g.nodes["sensor_01"].fields.value).toBe(22.5);
    expect(g.nodes["sensor_01"].fields.unit).toBe("°C");
  });

  it("parses meta annotations", () => {
    const g = parseKNDL(`node @x :: Foo {
  ~confidence 0.95
  ~source "agent://test"
}`);
    expect(g.nodes["x"].meta.confidence).toBe("0.95");
    expect(g.nodes["x"].meta.source).toBe("agent://test");
  });

  it("parses inline edges", () => {
    const g = parseKNDL(`node @sensor :: Temperature {
  location -> @building
}`);
    const edgesRaw = g.nodes["sensor"].edgesRaw;
    expect(edgesRaw).toHaveLength(1);
    expect(edgesRaw[0].label).toBe("location");
    expect(edgesRaw[0].target).toBe("building");
    // also promoted to graph.edges
    expect(g.edges).toContainEqual({ source: "sensor", target: "building", label: "location" });
  });

  it("parses standalone edge declaration", () => {
    const g = parseKNDL("edge @a -[linked_to]-> @b");
    expect(g.edges).toContainEqual({ source: "a", target: "b", label: "linked_to" });
  });

  it("parses multiple nodes", () => {
    const src = `
node @a :: Person { name = "Alice" }
node @b :: Person { name = "Bob" }
`;
    const g = parseKNDL(src);
    expect(Object.keys(g.nodes)).toHaveLength(2);
  });

  it("skips comment lines", () => {
    const g = parseKNDL(`// header comment
node @x :: Foo {
  // inline comment
  val = 1
}`);
    expect(g.nodes["x"].fields.val).toBe(1);
  });

  it("returns numeric values for integer fields", () => {
    const g = parseKNDL(`node @x :: Foo { count = 42 }`);
    expect(g.nodes["x"].fields.count).toBe(42);
  });

  it("returns string values for non-numeric fields", () => {
    const g = parseKNDL(`node @x :: Foo { label = "hello" }`);
    expect(g.nodes["x"].fields.label).toBe("hello");
  });

  it("returns empty graph for empty input", () => {
    const g = parseKNDL("");
    expect(Object.keys(g.nodes)).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("returns empty graph for comment-only input", () => {
    const g = parseKNDL("// just a comment\n// another comment");
    expect(Object.keys(g.nodes)).toHaveLength(0);
  });

  it("handles nodes with no fields", () => {
    const g = parseKNDL(`node @bare :: Empty {\n}`);
    expect(g.nodes["bare"]).toBeDefined();
    expect(Object.keys(g.nodes["bare"].fields)).toHaveLength(0);
  });

  it("collects edges from multiple nodes", () => {
    const src = `
node @a :: Foo { x -> @b }
node @b :: Bar { y -> @a }
`;
    const g = parseKNDL(src);
    expect(g.edges).toHaveLength(2);
  });

  it("deduplicates node id from @ref", () => {
    const g = parseKNDL(`node @my.node :: Foo { val = 1 }`);
    expect(g.nodes["my.node"]).toBeDefined();
  });
});

// ── typeColor ─────────────────────────────────────────────────────────────────

describe("typeColor", () => {
  it("returns known color for Temperature", () => {
    const c = typeColor("Temperature");
    expect(c.bg).toBe(TYPE_COLORS.Temperature.bg);
  });

  it("returns Unknown color for unrecognised types", () => {
    const c = typeColor("SomethingNew");
    expect(c.bg).toBe(TYPE_COLORS.Unknown.bg);
  });

  it("returns color with all required fields", () => {
    const c = typeColor("Person");
    expect(c).toHaveProperty("bg");
    expect(c).toHaveProperty("text");
    expect(c).toHaveProperty("glow");
  });

  it("covers all declared TYPE_COLORS keys", () => {
    for (const key of Object.keys(TYPE_COLORS)) {
      const c = typeColor(key);
      expect(c.bg).toBeTruthy();
    }
  });
});
