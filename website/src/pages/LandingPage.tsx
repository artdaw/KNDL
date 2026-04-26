import { Link } from "react-router";
import { SEO, softwareSourceCodeSchema } from "../components/SEO";
import styles from "./LandingPage.module.css";

const ALICE_FACT = `{
  "@id":       "fact:alice-role-20260415t000000z-e5f6g7h8",
  "@type":     "Fact",
  "statement": "Alice was promoted to staff engineer, payments team",

  "subject":   "person:alice",
  "predicate": "role",
  "object":    "staff engineer, payments",

  "confidence": 0.97,
  "decay":      "0.5/180d",
  "source":     "human://gleb",
  "validFrom":  "2026-04-15T00:00:00Z",
  "recordedAt": "2026-04-15T09:30:00Z",

  "supersedes": "fact:alice-role-20260101t000000z-a1b2c3d4"
}`;

const PILLARS = [
  {
    icon: "◈",
    title: "Confidence-native",
    desc: "Every fact carries a 0.0–1.0 certainty score. Agents reason about uncertainty, not boolean truth.",
    color: "var(--accent)",
  },
  {
    icon: "◷",
    title: "Decay-aware",
    desc: "Confidence degrades over time with configurable half-life. Stale facts are automatically down-weighted.",
    color: "var(--accent2)",
  },
  {
    icon: "◎",
    title: "Provenance-tracked",
    desc: "Every assertion names its source. Derived facts chain to their roots. Trust is computed, not assumed.",
    color: "var(--accent4)",
  },
  {
    icon: "⊕",
    title: "Bitemporal",
    desc: "validFrom tracks when the fact was true in the world. recordedAt tracks when it was written. Time-travel included.",
    color: "var(--accent3)",
  },
  {
    icon: "⊛",
    title: "Supersession",
    desc: "New facts can supersede old ones. Superseded facts are preserved for audit. The agent always reads the latest.",
    color: "var(--accent)",
  },
  {
    icon: "⚡",
    title: "Contradiction-ranked",
    desc: "When two facts conflict, the one with higher effective confidence wins. Agents surface conflicts, not silent lies.",
    color: "var(--accent2)",
  },
];

const USE_CASES = [
  { id: "loan-decision",    title: "Loan Decision",          desc: "Multi-bureau credit scores with decay and supersession" },
  { id: "iot-sensor",       title: "IoT Sensors",            desc: "Sensor readings with rapid half-life and fault derivation" },
  { id: "personal-memory",  title: "Personal Memory",        desc: "Contact facts with PII gates and role updates" },
  { id: "threat-intel",     title: "Threat Intelligence",    desc: "IOC feeds with retractions and false-positive resolution" },
  { id: "clinical",         title: "Clinical Records",       desc: "PHI facts with consent gates and diagnostic supersession" },
  { id: "ai-evals",         title: "AI Evals",               desc: "Benchmark scores with version supersession and regression tracking" },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="KNDL — The Memory Format for AI Agents"
        description="KNDL is the JSON-LD fact format built for Anthropic Memory. Confidence, decay, provenance, bitemporal records, supersession, and contradiction resolution — all in a single .fact.json file."
        path="/"
        type="website"
        keywords="KNDL, AI agent memory, Anthropic Memory, confidence decay, provenance, bitemporal facts, JSON-LD, fact format"
        jsonLd={softwareSourceCodeSchema()}
      />

      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.glowBg} />
        <div className={styles.heroLogo}>KNDL</div>
        <div className={styles.heroSub}>Knowledge Node Data Link</div>
        <div className={styles.heroTagline}>The format Anthropic Memory was waiting for</div>
        <div className={styles.heroPills}>
          <span>confidence</span>
          <span className={styles.pillarDot}>·</span>
          <span>decay</span>
          <span className={styles.pillarDot}>·</span>
          <span>provenance</span>
          <span className={styles.pillarDot}>·</span>
          <span>bitemporal</span>
          <span className={styles.pillarDot}>·</span>
          <span>supersession</span>
        </div>
        <div className={styles.heroActions}>
          <a
            href="https://claude.ai/download"
            target="_blank"
            rel="noreferrer"
            className={styles.btnPrimary}
          >
            Connect to Claude →
          </a>
          <Link to="/protocol" className={styles.btnSecondary}>The Fact Schema</Link>
        </div>
      </div>

      <div className={styles.container}>

        {/* Section 1 — The problem */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>The Problem</h2>
          <div className={styles.problemGrid}>
            <div className={styles.problemText}>
              <p className={styles.body}>
                Anthropic just shipped Memory: a filesystem agents can write to. They were
                deliberately unopinionated about format.
              </p>
              <p className={styles.body}>
                Without conventions, agents fill that filesystem with markdown that:
              </p>
              <ul className={styles.problemList}>
                <li>can't tell when a fact has gone stale</li>
                <li>can't surface contradictions between sources</li>
                <li>can't trace claims to their origins</li>
                <li>can't time-travel to reconstruct past state</li>
              </ul>
              <p className={styles.body} style={{ marginTop: "20px", color: "var(--text)" }}>
                <strong>KNDL is the missing convention layer.</strong>
              </p>
            </div>
            <div className={styles.factPreview}>
              <div className={styles.factLabel}>personal-memory / alice-role.fact.json</div>
              <pre className={styles.factCode}>{ALICE_FACT}</pre>
            </div>
          </div>
        </section>

        {/* Section 2 — Three layers */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Three Layers</h2>
          <div className={styles.layerGrid}>
            <div className={styles.layerCard} data-dim>
              <div className={styles.layerWhat}>WHERE</div>
              <div className={styles.layerName}>Anthropic Memory</div>
              <div className={styles.layerDesc}>Filesystem persistence. The platform layer. Anthropic owns this.</div>
            </div>
            <div className={styles.layerCard} data-accent>
              <div className={styles.layerWhat}>WHAT</div>
              <div className={styles.layerName} style={{ color: "var(--accent)" }}>KNDL</div>
              <div className={styles.layerDesc}>The fact format. JSON-LD with confidence, decay, provenance, and supersession. We own this.</div>
              <div className={styles.layerBadge} style={{ color: "var(--accent)" }}>This is us</div>
            </div>
            <div className={styles.layerCard} data-accent2>
              <div className={styles.layerWhat}>HOW</div>
              <div className={styles.layerName} style={{ color: "var(--accent2)" }}>kndl-mcp / CLI / Skill</div>
              <div className={styles.layerDesc}>assert_fact, query_facts, contradictions, provenance_chain. The tools that read and write KNDL.</div>
              <div className={styles.layerBadge} style={{ color: "var(--accent2)" }}>@kndl/memory</div>
            </div>
          </div>
        </section>

        {/* Section 3 — Six pillars */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Six Pillars</h2>
          <div className={styles.pillarGrid}>
            {PILLARS.map((p) => (
              <div
                key={p.title}
                className={styles.pillarCard}
                style={{ "--card-accent": p.color } as React.CSSProperties}
              >
                <span className={styles.pillarIcon}>{p.icon}</span>
                <h4 className={styles.pillarTitle} style={{ color: p.color }}>{p.title}</h4>
                <p className={styles.pillarDesc}>{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4 — Use cases */}
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Use Cases</h2>
          <div className={styles.useCaseGrid}>
            {USE_CASES.map((u) => (
              <Link key={u.id} to={`/explorer?domain=${u.id}`} className={styles.useCaseCard}>
                <div className={styles.useCaseTitle}>{u.title}</div>
                <div className={styles.useCaseDesc}>{u.desc}</div>
                <span className={styles.useCaseArrow}>→</span>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA row */}
        <section className={styles.ctaRow}>
          {[
            { to: "/protocol", label: "Protocol",  desc: "Fact schema reference" },
            { to: "/skill",    label: "Skill",      desc: "Agent reasoning guide" },
            { to: "/mcp",      label: "MCP",        desc: "Server + tool reference" },
            { to: "/examples", label: "Examples",   desc: "8 domain fact bundles" },
            { to: "/eval",     label: "Eval",       desc: "Scoreboard" },
          ].map(({ to, label, desc }) => (
            <Link key={to} to={to} className={styles.ctaCard}>
              <div className={styles.ctaLabel}>{label}</div>
              <div className={styles.ctaDesc}>{desc}</div>
              <span className={styles.ctaArrow}>→</span>
            </Link>
          ))}
        </section>

      </div>

      <footer className={styles.footer}>
        <p>KNDL — Knowledge Node Data Link</p>
        <p className={styles.footerMono}>
          The format Anthropic Memory was waiting for · v2
        </p>
        <p className={styles.footerSmall}>
          &copy; <a href="https://artdaw.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Gleb Galkin</a> 2026
        </p>
      </footer>
    </div>
  );
}
