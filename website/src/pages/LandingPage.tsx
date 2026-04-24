import { Link } from "react-router";
import CodeBlock from "../components/CodeBlock";
import { SEO, softwareSourceCodeSchema } from "../components/SEO";
import styles from "./LandingPage.module.css";

const HERO_EXAMPLE = `node @sensor_t001 :: Temperature {
  value    = 22.5
  unit     = "°C"
  location -> @building_7
  ~confidence 0.94
  ~source     "sensor://bldg-7/t-001"
  ~valid      2026-04-10T14:00Z .. *
  ~decay      0.95 / 1h
}`;

const FEATURES = [
  {
    icon: "◈",
    title: "Semantic-first",
    desc: "Every token carries meaning. No presentational noise. Structure IS semantics.",
    color: "var(--accent)",
  },
  {
    icon: "⊛",
    title: "Confidence-native",
    desc: "Every fact has a certainty score (0.0–1.0). Agents don't deal in absolutes.",
    color: "var(--accent2)",
  },
  {
    icon: "⊕",
    title: "Graph-structured",
    desc: "Knowledge is a directed graph with typed edges — not a flat document.",
    color: "var(--accent3)",
  },
  {
    icon: "◷",
    title: "Temporally-aware",
    desc: "Facts have validity windows and decay rates. Truth is time-bounded.",
    color: "var(--accent4)",
  },
  {
    icon: "◎",
    title: "Provenance-tracked",
    desc: "Every assertion traces to its source. Trust is computed, not assumed.",
    color: "var(--accent)",
  },
  {
    icon: "⚡",
    title: "Agent-actionable",
    desc: "Intents encode trigger-action patterns. The graph IS the orchestration.",
    color: "var(--accent2)",
  },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="KNDL — Knowledge Node Description Language"
        description="Graph-based knowledge representation language for AI agents. Typed nodes, 0.0–1.0 confidence scores, temporal decay, cryptographic provenance, native intent and process blocks. Spec, EBNF, MCP server, and examples."
        path="/"
        type="website"
        keywords="knowledge graph, AI agents, knowledge representation, KNDL, confidence, temporal decay, provenance, MCP, LLM memory, agent memory"
        jsonLd={softwareSourceCodeSchema()}
      />
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.glowBg} />
        <div className={styles.logo}>
          KNDL
        </div>
        <div className={styles.subtitle}>Knowledge Node Description Language</div>
        <div className={styles.tagline}>
          semantic-first · agent-native · confidence-aware · graph-structured
        </div>
        <div className={styles.heroActions}>
          <Link to="/spec" className={styles.btnPrimary}>Read the Spec →</Link>
          <Link to="/workflow" className={styles.btnSecondary}>See it in Action</Link>
        </div>
      </div>

      <div className={styles.container}>
        {/* Quick look */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Quick Look</h2>
          <div className={styles.quickLook}>
            <div>
              <p className={styles.body}>
                KNDL is a language designed for AI agents to represent, store, query,
                and exchange structured knowledge. Unlike JSON or YAML, every assertion
                carries <strong>confidence</strong>, <strong>provenance</strong>,
                <strong> temporal scope</strong>, and <strong>typed relationships</strong> as
                first-class constructs.
              </p>
              <p className={styles.body}>
                Agents don't deal in absolutes — neither should their data.
              </p>
              <div className={styles.pillRow}>
                <span className={styles.pill} style={{ borderColor: "var(--accent)" }}>
                  .kndl text
                </span>
                <span className={styles.pill} style={{ borderColor: "var(--accent2)" }}>
                  .kndlb binary
                </span>
                <span className={styles.pill} style={{ borderColor: "var(--accent3)" }}>
                  MCP server
                </span>
                <span className={styles.pill} style={{ borderColor: "var(--accent4)" }}>
                  Python lib
                </span>
              </div>
            </div>
            <CodeBlock code={HERO_EXAMPLE} label="temperature.kndl" />
          </div>
        </section>

        {/* Features */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Design Goals</h2>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className={styles.featureCard}
                style={{ "--card-accent": f.color } as React.CSSProperties}
              >
                <span className={styles.featureIcon}>{f.icon}</span>
                <h4 className={styles.featureTitle} style={{ color: f.color }}>
                  {f.title}
                </h4>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA row */}
        <section className={styles.ctaRow}>
          <Link to="/spec" className={styles.ctaCard}>
            <span className={styles.ctaIcon}>📄</span>
            <div>
              <div className={styles.ctaTitle}>Language Specification</div>
              <div className={styles.ctaDesc}>Full syntax, type system, EBNF grammar</div>
            </div>
            <span className={styles.ctaArrow}>→</span>
          </Link>
          <Link to="/workflow" className={styles.ctaCard}>
            <span className={styles.ctaIcon}>🔄</span>
            <div>
              <div className={styles.ctaTitle}>Agent Workflow</div>
              <div className={styles.ctaDesc}>6-stage interactive pipeline walkthrough</div>
            </div>
            <span className={styles.ctaArrow}>→</span>
          </Link>
          <Link to="/mcp" className={styles.ctaCard}>
            <span className={styles.ctaIcon}>🔌</span>
            <div>
              <div className={styles.ctaTitle}>MCP Server</div>
              <div className={styles.ctaDesc}>Use KNDL from Claude Desktop and agents</div>
            </div>
            <span className={styles.ctaArrow}>→</span>
          </Link>
        </section>
      </div>

      <footer className={styles.footer}>
        <p>KNDL — Knowledge Node Description Language</p>
        <p className={styles.footerMono}>
          Designed for the age of agents · v1.0 specification
        </p>
        <p className={styles.footerSmall}>
          &copy; <a href="https://artdaw.com" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Gleb Galkin</a> 2026
        </p>
      </footer>
    </div>
  );
}
