import CodeBlock from "../components/CodeBlock";
import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./McpPage.module.css";

// ── Accurate tool list (matches server.ts TOOLS array) ───────────────────────

const TOOLS_CORE = [
  { name: "assert_fact",      desc: "Write a new immutable Fact. Returns the generated @id." },
  { name: "query_facts",      desc: "Search by subject, predicate, as_of time, min_confidence, tenant. Returns effective_confidence after decay." },
  { name: "contradictions",   desc: "Find facts with conflicting values for the same subject+predicate, ranked by recency and effective confidence." },
  { name: "supersede_fact",   desc: "Assert a new Fact that supersedes an older one. Old fact preserved for as_of time-travel." },
  { name: "as_of",            desc: "Bitemporal query: return what memory believed at a specific past timestamp." },
  { name: "provenance_chain", desc: "Traverse derivedFrom + supersedes links to return the full audit trail of a Fact." },
];

const TOOLS_SUBSCRIPTIONS = [
  { name: "subscribe",          desc: "Register for notifications/resources/updated when a matching fact changes. Returns subscription id." },
  { name: "unsubscribe",        desc: "Cancel a subscription by id." },
  { name: "list_subscriptions", desc: "List active subscriptions and session count." },
];

const TOOLS_REMOTE = [
  { name: "sync_memory_store",  desc: "Pull facts from an Anthropic Memory Store into local storage. Requires ANTHROPIC_API_KEY." },
  { name: "list_memory_stores", desc: "List configured remote Anthropic Memory Stores and their last-sync timestamps." },
];

// ── Code blocks — verified against actual implementation ──────────────────────

const INSTALL_CODE = `# 1. Clone and build
git clone https://github.com/artdaw/kndl.git
cd kndl/packages/kndl-memory
pnpm install
pnpm build

# Two binaries produced:
#   dist/cli.js     → kndl  (CLI)
#   dist/server.js  → kndl-memory-mcp  (MCP server)`;

// Default storage is fs:./memory (Anthropic Memory mount).
// For Claude Desktop without Anthropic Memory, sqlite is recommended.
const CLAUDE_CONFIG = `{
  "mcpServers": {
    "kndl-memory": {
      "command": "node",
      "args": ["/path/to/kndl/packages/kndl-memory/dist/server.js"],
      "env": {
        "KNDL_STORAGE": "sqlite:./kndl-memory.db"
      }
    }
  }
}`;

const ANTHROPIC_MEMORY_CONFIG = `{
  "mcpServers": {
    "kndl-memory": {
      "command": "node",
      "args": ["/path/to/kndl/packages/kndl-memory/dist/server.js"],
      "env": {
        "KNDL_STORAGE": "fs:/memory/facts-store"
      }
    }
  }
}`;

// HTTP server defaults to port 8000
const LM_STUDIO_CONFIG = `# 1. Start the HTTP server (default port 8000)
KNDL_STORAGE=sqlite:./kndl-memory.db \\
  node /path/to/kndl/packages/kndl-memory/dist/server.js --http

# 2. Add to ~/.lmstudio/mcp.json
{
  "mcpServers": {
    "kndl-memory": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}`;

const GOOSE_CONFIG = `# Start HTTP server first (port 8000)
KNDL_STORAGE=sqlite:./kndl-memory.db \\
  node /path/to/kndl/packages/kndl-memory/dist/server.js --http

# ~/.config/goose/config.yaml
extensions:
  kndl-memory:
    type: streamable_http
    url: http://localhost:8000/mcp`;

// Storage: fs:, sqlite:, duckdb:, supabase: — no postgres support
const STORAGE_TABLE = [
  { url: "fs:./memory",               desc: "Filesystem — one .fact.json per fact",    when: "Anthropic Memory mount (default)" },
  { url: "sqlite:./kndl-memory.db",   desc: "SQLite — single file, WAL mode",          when: "Claude Desktop / standalone (recommended)" },
  { url: "duckdb:./kndl-memory.duckdb", desc: "DuckDB — columnar",                     when: "Analytical workloads" },
  { url: "supabase:<url>?key=<anon>", desc: "Supabase — Postgres + RLS",               when: "Multi-tenant cloud" },
];

// Remote sync: Anthropic Memory Stores API (not generic endpoints)
const REMOTE_SYNC = `# Register an Anthropic Memory Store
kndl remote add --provider anthropic \\
  --store-id store_abc123 --label personal

# Pull facts from that store into local storage
# (requires ANTHROPIC_API_KEY)
kndl remote pull personal

# Or trigger via MCP tool:
# sync_memory_store({ label: "personal", direction: "pull" })

# List all registered remotes
kndl remote ls

# Remove a remote
kndl remote rm personal`;

const USAGE_EXAMPLE = `# Ask Claude to remember a fact
"Alice was promoted to staff engineer on the payments team."

# Claude calls assert_fact:
{
  "statement": "Alice was promoted to staff engineer, payments team",
  "subject":   "person:alice",
  "predicate": "role",
  "object":    "staff engineer, payments",
  "confidence": 0.95,
  "source":    "human://user",
  "validFrom": "2026-04-15T00:00:00Z",
  "decay":     "0.5/180d"
}

# Later — ask about Alice
"What do you know about Alice?"

# Claude calls query_facts({ subject: "person:alice" })
# Returns all active facts ordered by effective_confidence (post-decay)`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function McpPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="kndl-memory-mcp — HOW Layer for KNDL Facts"
        description="Install and configure kndl-memory-mcp for Claude Desktop, LM Studio, and Goose. 11 MCP tools: assert_fact, query_facts, contradictions, as_of, provenance_chain, subscribe, sync_memory_store and more."
        path="/mcp"
        type="article"
        keywords="kndl-memory-mcp, MCP server, Claude Desktop, LM Studio, Goose, assert_fact, query_facts, agent memory, Anthropic Memory"
        jsonLd={techArticleSchema({
          headline: "kndl-memory-mcp — HOW Layer for KNDL Facts",
          description: "11 MCP tools for confidence-aware, decay-tracked, provenance-linked agent memory.",
          path: "/mcp",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.tag}>MCP · @kndl/memory</div>
          <h1 className={styles.title}>kndl-memory-mcp</h1>
          <p className={styles.desc}>
            The HOW layer. kndl-memory-mcp exposes KNDL fact memory as 11 Model Context Protocol
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
            Package: <code className={styles.ic}>@kndl/memory</code> · Binaries:{" "}
            <code className={styles.ic}>kndl</code> (CLI) and{" "}
            <code className={styles.ic}>kndl-memory-mcp</code> (MCP server)
          </p>
        </section>

        {/* Storage */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Storage backends (<code className={styles.ic}>KNDL_STORAGE</code>)</h2>
          <p className={styles.p}>
            Set <code className={styles.ic}>KNDL_STORAGE</code> in the server's environment.
            Default (when unset) is <code className={styles.ic}>fs:./memory</code> — filesystem,
            one <code className={styles.ic}>.fact.json</code> per fact, compatible with Anthropic Memory mounts.
          </p>
          <div className={styles.storageTable}>
            {STORAGE_TABLE.map(({ url, desc, when }) => (
              <div key={url} className={styles.storageRow}>
                <code className={styles.storageUrl}>{url}</code>
                <span className={styles.storageDesc}>{desc}</span>
                <span className={styles.storageWhen}>{when}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Claude Desktop */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Claude Desktop — standalone (SQLite)</h2>
          <p className={styles.p}>
            For Claude Desktop without Anthropic Memory, use SQLite — single file, WAL mode,
            persists across restarts:
          </p>
          <CodeBlock code={CLAUDE_CONFIG} label="claude_desktop_config.json" />

          <h3 className={styles.h3}>Claude Desktop — with Anthropic Memory mount</h3>
          <p className={styles.p}>
            When running inside an Anthropic Managed Agent with a <code className={styles.ic}>/memory</code>{" "}
            mount, use <code className={styles.ic}>fs:</code> so facts are actual files in the Memory filesystem:
          </p>
          <CodeBlock code={ANTHROPIC_MEMORY_CONFIG} label="claude_desktop_config.json (Anthropic Memory)" />
        </section>

        {/* LM Studio */}
        <section className={styles.section}>
          <h2 className={styles.h2}>LM Studio</h2>
          <p className={styles.p}>
            Run the server in HTTP mode (default port <strong>8000</strong>), then register
            it as an HTTP MCP extension:
          </p>
          <CodeBlock code={LM_STUDIO_CONFIG} label="terminal + ~/.lmstudio/mcp.json" />
        </section>

        {/* Goose */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Goose</h2>
          <p className={styles.p}>
            Add a <code className={styles.ic}>streamable_http</code> extension pointing at
            the running HTTP server:
          </p>
          <CodeBlock code={GOOSE_CONFIG} label="terminal + ~/.config/goose/config.yaml" />
        </section>

        {/* Tool reference */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Tool reference — 11 tools</h2>

          <h3 className={styles.h3}>Core (6)</h3>
          <div className={styles.toolGrid}>
            {TOOLS_CORE.map((t) => (
              <div key={t.name} className={styles.toolRow}>
                <code className={styles.toolName}>{t.name}</code>
                <span className={styles.toolDesc}>{t.desc}</span>
              </div>
            ))}
          </div>

          <h3 className={styles.h3} style={{ marginTop: "24px" }}>Subscriptions (3)</h3>
          <div className={styles.toolGrid}>
            {TOOLS_SUBSCRIPTIONS.map((t) => (
              <div key={t.name} className={styles.toolRow}>
                <code className={styles.toolName}>{t.name}</code>
                <span className={styles.toolDesc}>{t.desc}</span>
              </div>
            ))}
          </div>

          <h3 className={styles.h3} style={{ marginTop: "24px" }}>Remote sync (2)</h3>
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
          <h2 className={styles.h2}>Remote sync — Anthropic Memory Stores</h2>
          <p className={styles.p}>
            Pull facts from an Anthropic Memory Store into local storage via CLI or MCP tool.
            Requires <code className={styles.ic}>ANTHROPIC_API_KEY</code>. Push is deferred to v2.1.
          </p>
          <CodeBlock code={REMOTE_SYNC} label="terminal" />
        </section>

        {/* Usage example */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Usage with Claude</h2>
          <p className={styles.p}>
            Once connected, natural language becomes structured KNDL facts:
          </p>
          <CodeBlock code={USAGE_EXAMPLE} label="conversation → assert_fact → query_facts" />
        </section>

        {/* Architecture */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Architecture</h2>
          <div className={styles.archGrid}>
            {[
              {
                layer: "Transport",
                options: ["stdio (Claude Desktop)", "Streamable HTTP — port 8000 (LM Studio / Goose)"],
                color: "var(--accent)",
              },
              {
                layer: "Runtime",
                options: ["Node.js TypeScript", "@modelcontextprotocol/sdk v1.29"],
                color: "var(--accent2)",
              },
              {
                layer: "Storage",
                options: ["fs: — filesystem .fact.json", "sqlite: — WAL SQLite", "duckdb: — columnar", "supabase: — cloud RLS"],
                color: "var(--accent4)",
              },
              {
                layer: "Format",
                options: ["KNDL Fact JSON-LD v2", "context/v1.jsonld", "fact.schema.json"],
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
