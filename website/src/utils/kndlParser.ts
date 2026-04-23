/**
 * Browser-side KNDL parser — lightweight, regex-based.
 * Extracts nodes, fields, meta, and edges for graph visualization.
 * Not a full KNDL implementation; use the Python library for production parsing.
 */

export interface EdgeRef {
  label: string;
  target: string;
}

export interface GraphNodeData {
  id: string;
  typeName: string;
  fields: Record<string, string | number>;
  meta: Record<string, string>;
  edgesRaw: EdgeRef[];
}

export interface GraphData {
  nodes: Record<string, GraphNodeData>;
  edges: Array<{ source: string; target: string; label: string }>;
}

export function parseKNDL(src: string): GraphData {
  const graph: GraphData = { nodes: {}, edges: [] };
  const lines = src.split("\n");
  let i = 0;

  function skipWS(): void {
    while (i < lines.length) {
      const l = lines[i].trim();
      if (l === "" || l.startsWith("//")) i++;
      else break;
    }
  }

  function parseBlock(): GraphNodeData {
    const header = lines[i].trim();
    const idMatch = header.match(/@([\w.]+)/);
    const typeMatch = header.match(/::\s*(\w+)/);
    const id = idMatch ? idMatch[1] : `node_${i}`;
    const typeName = typeMatch ? typeMatch[1] : "Unknown";
    const fields: Record<string, string | number> = {};
    const meta: Record<string, string> = {};
    const edgesRaw: EdgeRef[] = [];

    function parseLine(l: string): void {
      const edgeMatch = l.match(/^(\w+)\s*->\s*@([\w.]+)/);
      if (edgeMatch) { edgesRaw.push({ label: edgeMatch[1], target: edgeMatch[2] }); return; }
      const metaMatch = l.match(/^~(\w+)\s+(.+)/);
      if (metaMatch) { meta[metaMatch[1]] = metaMatch[2].replace(/^["']|["']$/g, ""); return; }
      const fieldMatch = l.match(/^(\w+)\s*=\s*(.+)/);
      if (fieldMatch) {
        const raw = fieldMatch[2].trim().replace(/^["']|["']$/g, "");
        fields[fieldMatch[1]] = isNaN(Number(raw)) || raw === "" ? raw : Number(raw);
      }
    }

    // single-line form: node @id :: Type { content }
    const inlineMatch = header.match(/\{([^}]*)\}/);
    if (inlineMatch) {
      const content = inlineMatch[1].trim();
      if (content) parseLine(content);
      i++;
      return { id, typeName, fields, meta, edgesRaw };
    }

    i++;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (l === "}") { i++; break; }
      if (l === "" || l.startsWith("//")) { i++; continue; }
      parseLine(l);
      i++;
    }

    return { id, typeName, fields, meta, edgesRaw };
  }

  while (i < lines.length) {
    skipWS();
    if (i >= lines.length) break;
    const l = lines[i].trim();

    if (l.startsWith("node ")) {
      const node = parseBlock();
      graph.nodes[node.id] = node;
    } else if (l.startsWith("edge ")) {
      // standalone edge: edge @a -[type]-> @b
      const m = l.match(/edge\s+@([\w.]+)\s+-\[(\w+)\]->\s*@([\w.]+)/);
      if (m) graph.edges.push({ source: m[1], target: m[3], label: m[2] });
      i++;
    } else {
      i++;
    }
  }

  // resolve inline edges
  for (const [id, node] of Object.entries(graph.nodes)) {
    for (const e of node.edgesRaw) {
      graph.edges.push({ source: id, target: e.target, label: e.label });
    }
  }

  return graph;
}

export const TYPE_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  Temperature:  { bg: "#FF6B35", text: "#fff",    glow: "rgba(255,107,53,0.4)" },
  Measurement:  { bg: "#F7C59F", text: "#1a0a00", glow: "rgba(247,197,159,0.4)" },
  Location:     { bg: "#4ECDC4", text: "#fff",    glow: "rgba(78,205,196,0.4)" },
  Person:       { bg: "#A8DADC", text: "#1a2e3b", glow: "rgba(168,218,220,0.4)" },
  Organization: { bg: "#457B9D", text: "#fff",    glow: "rgba(69,123,157,0.4)" },
  Event:        { bg: "#E63946", text: "#fff",    glow: "rgba(230,57,70,0.4)" },
  Concept:      { bg: "#8338EC", text: "#fff",    glow: "rgba(131,56,236,0.4)" },
  Document:     { bg: "#3A86FF", text: "#fff",    glow: "rgba(58,134,255,0.4)" },
  Building:     { bg: "#06D6A0", text: "#fff",    glow: "rgba(6,214,160,0.4)" },
  Device:       { bg: "#FFD93D", text: "#1a0a00", glow: "rgba(255,217,61,0.4)" },
  Unknown:      { bg: "#6B7280", text: "#fff",    glow: "rgba(107,114,128,0.4)" },
};

export function typeColor(typeName: string): { bg: string; text: string; glow: string } {
  return TYPE_COLORS[typeName] ?? TYPE_COLORS.Unknown;
}
