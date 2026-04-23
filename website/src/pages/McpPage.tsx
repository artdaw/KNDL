import CodeBlock from "../components/CodeBlock";
import styles from "./McpPage.module.css";

const TOOLS = [
  { name: "kndl_parse",       desc: "Parse KNDL source text and load it into the graph" },
  { name: "kndl_add_node",    desc: "Add a node with type, fields, and meta-annotations" },
  { name: "kndl_add_edge",    desc: "Add a typed directed edge between nodes" },
  { name: "kndl_query_nodes", desc: "Query by type, confidence threshold, and field filters" },
  { name: "kndl_get_node",    desc: "Get a node with all its incoming and outgoing edges" },
  { name: "kndl_update_node", desc: "Update a node's fields and meta-annotations" },
  { name: "kndl_remove_node", desc: "Remove a node and all connected edges" },
  { name: "kndl_neighborhood","desc": "Get the N-hop subgraph around a node" },
  { name: "kndl_serialize",   desc: "Export the current graph as KNDL text" },
  { name: "kndl_graph_stats", desc: "Get summary statistics (counts, types, avg confidence)" },
  { name: "kndl_add_intent",  desc: "Add a reactive trigger-action rule" },
  { name: "kndl_merge_graphs","desc": "Merge new KNDL source into the existing graph" },
  { name: "kndl_reset",       desc: "Clear the entire graph (destructive)" },
];

const INSTALL_CODE = `# Install KNDL Python library
pip install kndl

# Install MCP server
pip install kndl-mcp`;

const RUN_CODE = `# stdio transport — for Claude Desktop
python -m kndl_mcp

# Streamable HTTP transport — for remote agents
python -m kndl_mcp --http`;

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "kndl": {
      "command": "python",
      "args": ["-m", "kndl_mcp"],
      "env": {}
    }
  }
}`;

const USAGE_EXAMPLE = `// 1. Tell Claude to load your knowledge graph
"Load this KNDL file into the knowledge graph:

node @room_a :: SmartRoom {
  temp     = 22.5
  occupied = true
  ~confidence 0.95
  ~source \\"sensor://room-a\\"
}"

// 2. Query it
"Find all rooms where temperature > 24°C
with confidence > 0.8"

// 3. Claude uses kndl_query_nodes internally:
{
  type_name: "SmartRoom",
  min_confidence: 0.8,
  field_filters: {}
}

// 4. Update knowledge
"Mark room A as unoccupied and decrease
confidence to 0.6 due to sensor uncertainty"`;

export default function McpPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.tag}>KNDL MCP Server</div>
          <h1 className={styles.title}>Use KNDL from Claude & AI Agents</h1>
          <p className={styles.desc}>
            The KNDL MCP server exposes the full knowledge graph API as Model Context
            Protocol tools. Connect it to Claude Desktop, Claude Code, or any MCP-compatible
            agent to give your AI a confidence-aware, graph-structured memory.
          </p>
        </div>

        {/* Install */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Installation</h2>
          <CodeBlock code={INSTALL_CODE} label="terminal" />
        </section>

        {/* Run */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Running the Server</h2>
          <CodeBlock code={RUN_CODE} label="terminal" />
        </section>

        {/* Claude Desktop config */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Claude Desktop Configuration</h2>
          <p className={styles.p}>
            Add to your <code className={styles.ic}>claude_desktop_config.json</code>:
          </p>
          <CodeBlock code={CLAUDE_CONFIG} label="claude_desktop_config.json" />
        </section>

        {/* Tools */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Available MCP Tools</h2>
          <div className={styles.toolGrid}>
            {TOOLS.map((t) => (
              <div key={t.name} className={styles.toolRow}>
                <code className={styles.toolName}>{t.name}</code>
                <span className={styles.toolDesc}>{t.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Usage example */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Usage with Claude</h2>
          <p className={styles.p}>
            Once connected, you can have natural conversations that build, query,
            and reason over a persistent KNDL knowledge graph:
          </p>
          <CodeBlock code={USAGE_EXAMPLE} label="conversation" />
        </section>

        {/* Resources */}
        <section className={styles.section}>
          <h2 className={styles.h2}>MCP Resources</h2>
          <div className={styles.resourceList}>
            <div className={styles.resourceRow}>
              <code className={styles.toolName}>kndl://spec/version</code>
              <span className={styles.toolDesc}>Get the KNDL specification version</span>
            </div>
            <div className={styles.resourceRow}>
              <code className={styles.toolName}>kndl://graph/summary</code>
              <span className={styles.toolDesc}>Get a text summary of the current graph</span>
            </div>
          </div>
        </section>

        {/* Architecture */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Architecture</h2>
          <div className={styles.archGrid}>
            {[
              {
                layer: "Transport",
                options: ["stdio (Claude Desktop)", "Streamable HTTP (remote agents)"],
                color: "var(--accent)",
              },
              {
                layer: "Protocol",
                options: ["MCP (Model Context Protocol)", "FastMCP framework"],
                color: "var(--accent2)",
              },
              {
                layer: "Engine",
                options: ["KNDLGraph in-memory store", "kndl Python library"],
                color: "var(--accent4)",
              },
              {
                layer: "Persistence",
                options: ["Serialize to .kndl file", "Reload on startup (planned)"],
                color: "var(--accent3)",
              },
            ].map((item) => (
              <div
                key={item.layer}
                className={styles.archCard}
                style={{ "--card-color": item.color } as React.CSSProperties}
              >
                <div className={styles.archLayer} style={{ color: item.color }}>
                  {item.layer}
                </div>
                {item.options.map((o) => (
                  <div key={o} className={styles.archOption}>{o}</div>
                ))}
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
