import CodeBlock from "../components/CodeBlock";
import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./McpPage.module.css";

const TOOLS_CORE = [
  { name: "assert_fact",       desc: "Write a new Fact to memory. Returns the @id." },
  { name: "query_facts",       desc: "Search by subject, predicate, tags, or time range. Returns effective_confidence." },
  { name: "get_fact",          desc: "Retrieve a single Fact by @id." },
  { name: "supersede_fact",    desc: "Assert a new Fact that supersedes an existing one." },
  { name: "contradictions",    desc: "Find facts with conflicting values for the same subject+predicate." },
  { name: "provenance_chain",  desc: "Traverse derivedFrom links to return the full ancestry of a Fact." },
];

const TOOLS_REMOTE = [
  { name: "remote_add",   desc: "Register a remote KNDL memory endpoint (URL + optional token)." },
  { name: "remote_pull",  desc: "Sync facts from a remote endpoint into local memory." },
  { name: "remote_ls",    desc: "List all registered remote endpoints." },
];

const INSTALL_CODE = `# 1. Clone and build
git clone https://github.com/artdaw/kndl.git
cd kndl
pnpm install
pnpm build

# Two binaries are produced:
#   dist/cli.js        → kndl CLI
#   dist/server.js     → kndl-memory-mcp server`;

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "kndl-memory": {
      "command": "node",
      "args": ["/path/to/kndl/dist/server.js"],
      "env": {
        "KNDL_STORAGE": "sqlite:/Users/you/kndl-memory.db"
      }
    }
  }
}`;

const LM_STUDIO_CONFIG = `{
  "mcpServers": {
    "kndl-memory": {
      "type": "http",
      "url": "http://localhost:7654/mcp"
    }
  }
}

# Start the HTTP server first:
node dist/server.js --http --port 7654`;

const GOOSE_CONFIG = `# ~/.config/goose/config.yaml
extensions:
  kndl-memory:
    type: streamable_http
    url: http://localhost:7654/mcp`;

const REMOTE_SYNC = `# Add a remote endpoint
kndl remote add team-memory https://memory.example.com/kndl --token $TOKEN

# Pull facts from remote into local
kndl remote pull team-memory

# List registered remotes
kndl remote ls

# Remove a remote
kndl remote rm team-memory`;

const USAGE_EXAMPLE = `# Ask Claude to remember a fact
"Alice was promoted to staff engineer on the payments team."

# Claude calls assert_fact internally:
{
  "statement": "Alice was promoted to staff engineer, payments team",
  "subject": "person:alice",
  "predicate": "role",
  "object": "staff engineer, payments",
  "confidence": 0.95,
  "source": "human://user",
  "validFrom": "2026-04-15T00:00:00Z",
  "decay": "0.5/180d"
}

# Later — ask about Alice
"What do you know about Alice?"

# Claude calls query_facts({ subject: "person:alice" })
# Returns all facts ordered by effective_confidence`;

export default function McpPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="kndl-memory-mcp — HOW Layer for KNDL Facts"
        description="Install and configure the kndl-memory-mcp server for Claude Desktop, LM Studio, and Goose. Tool reference for assert_fact, query_facts, contradictions, provenance_chain, and remote sync."
        path="/mcp"
        type="article"
        keywords="kndl-memory-mcp, MCP server, Claude Desktop, LM Studio, Goose, assert_fact, query_facts, agent memory tools"
        jsonLd={techArticleSchema({
          headline: "kndl-memory-mcp — HOW Layer for KNDL Facts",
          description: "Install and configure the kndl-memory-mcp server. Tool and remote sync reference.",
          path: "/mcp",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.tag}>MCP · @kndl/memory</div>
          <h1 className={styles.title}>kndl-memory-mcp</h1>
          <p className={styles.desc}>
            The HOW layer. kndl-memory-mcp exposes KNDL fact memory as Model Context Protocol
            tools. Connect it to Claude Desktop, LM Studio, Goose, or any MCP-compatible agent
            to give it a confidence-aware, decay-tracked, provenance-linked memory.
          </p>
          <div className={styles.layerPills}>
            <span className={styles.layerPill} data-dim>Anthropic Memory = WHERE</span>
            <span className={styles.layerPill} data-mid>KNDL = WHAT</span>
            <span className={styles.layerPill} data-accent>kndl-mcp = HOW</span>
          </div>
        </div>

        {/* Install */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Installation</h2>
          <CodeBlock code={INSTALL_CODE} label="terminal" />
          <p className={styles.p} style={{ marginTop: "16px" }}>
            Package: <code className={styles.ic}>@kndl/memory</code> · Binaries:
            <code className={styles.ic}>kndl</code> CLI and{" "}
            <code className={styles.ic}>kndl-memory-mcp</code> server
          </p>
        </section>

        {/* Claude Desktop */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Claude Desktop</h2>
          <p className={styles.p}>
            Add to <code className={styles.ic}>claude_desktop_config.json</code>.{" "}
            Set <code className={styles.ic}>KNDL_STORAGE</code> to a SQLite path or{" "}
            <code className={styles.ic}>postgres://...</code> for a shared database:
          </p>
          <CodeBlock code={CLAUDE_CONFIG} label="claude_desktop_config.json" />
        </section>

        {/* LM Studio */}
        <section className={styles.section}>
          <h2 className={styles.h2}>LM Studio</h2>
          <p className={styles.p}>
            Run the server in HTTP mode, then register it as an HTTP MCP extension:
          </p>
          <CodeBlock code={LM_STUDIO_CONFIG} label="lm-studio-config.json + terminal" />
        </section>

        {/* Goose */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Goose</h2>
          <p className={styles.p}>
            Add a <code className={styles.ic}>streamable_http</code> extension pointing
            at the running server:
          </p>
          <CodeBlock code={GOOSE_CONFIG} label="~/.config/goose/config.yaml" />
        </section>

        {/* Tool reference */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Tool Reference — Core (6 tools)</h2>
          <div className={styles.toolGrid}>
            {TOOLS_CORE.map((t) => (
              <div key={t.name} className={styles.toolRow}>
                <code className={styles.toolName}>{t.name}</code>
                <span className={styles.toolDesc}>{t.desc}</span>
              </div>
            ))}
          </div>

          <h2 className={styles.h2} style={{ marginTop: "32px" }}>Tool Reference — Remote Sync (3 tools)</h2>
          <div className={styles.toolGrid}>
            {TOOLS_REMOTE.map((t) => (
              <div key={t.name} className={styles.toolRow}>
                <code className={styles.toolName}>{t.name}</code>
                <span className={styles.toolDesc}>{t.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Remote sync CLI */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Remote Sync</h2>
          <p className={styles.p}>
            Sync facts between local memory and a remote KNDL endpoint using the CLI:
          </p>
          <CodeBlock code={REMOTE_SYNC} label="terminal" />
        </section>

        {/* Usage example */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Usage with Claude</h2>
          <p className={styles.p}>
            Once connected, natural language instructions become structured KNDL facts:
          </p>
          <CodeBlock code={USAGE_EXAMPLE} label="conversation + assert_fact call" />
        </section>

        {/* Architecture */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Architecture</h2>
          <div className={styles.archGrid}>
            {[
              {
                layer: "Transport",
                options: ["stdio (Claude Desktop)", "Streamable HTTP (LM Studio / Goose)"],
                color: "var(--accent)",
              },
              {
                layer: "Protocol",
                options: ["MCP (Model Context Protocol)", "Node.js TypeScript server"],
                color: "var(--accent2)",
              },
              {
                layer: "Storage",
                options: ["SQLite (local / default)", "PostgreSQL (shared teams)"],
                color: "var(--accent4)",
              },
              {
                layer: "Format",
                options: ["KNDL Fact JSON-LD v2", ".fact.json files on disk"],
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
