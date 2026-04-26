import { Link } from "react-router";
import { SEO, softwareSourceCodeSchema } from "../components/SEO";
import JsonHighlight from "../components/JsonHighlight";
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
  {
    id: "loan-decision",
    title: "Loan Decision",
    tag: "7 facts · supersession · contradiction",
    desc: "Multi-bureau credit scores with decay and supersession. Stale income facts automatically down-weighted.",
    icon: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11",
  },
  {
    id: "iot-sensor",
    title: "IoT Sensors",
    tag: "6 facts · decay · derivedFrom",
    desc: "Sensor readings with rapid half-life decay and HVAC fault derived from temperature + occupancy.",
    icon: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18",
  },
  {
    id: "personal-memory",
    title: "Personal Memory",
    tag: "5 facts · PII · supersession",
    desc: "Contact facts with PII classification gates. Role updates supersede previous entries.",
    icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  },
  {
    id: "threat-intel",
    title: "Threat Intelligence",
    tag: "5 facts · negation · contradiction",
    desc: "IOC feeds with fast decay. False-positive retractions via negated:true. Conflicting classifications surfaced.",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
  {
    id: "clinical",
    title: "Clinical Records",
    tag: "5 facts · PHI · derivedFrom",
    desc: "PHI facts with consent gates. Preliminary diagnosis superseded by lab-confirmed. Prescription derived from diagnosis chain.",
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
  },
  {
    id: "ai-evals",
    title: "AI Evals",
    tag: "5 facts · supersession · regression",
    desc: "Benchmark scores with version supersession. v1.5 regression detected as contradiction. Capability claim derived from multiple evals.",
    icon: "M18 20V10M12 20V4M6 20v-6",
  },
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
              <JsonHighlight src={ALICE_FACT} className={styles.factCode} />
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
                <div className={styles.useCaseTop}>
                  <svg className={styles.useCaseIcon} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true">
                    <path d={u.icon} />
                  </svg>
                  <div className={styles.useCaseMeta}>
                    <div className={styles.useCaseTitle}>{u.title}</div>
                    <div className={styles.useCaseTag}>{u.tag}</div>
                  </div>
                </div>
                <div className={styles.useCaseDesc}>{u.desc}</div>
                <div className={styles.useCaseHint}>Explore in graph →</div>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA row */}
        <section className={styles.ctaRow}>
          {[
            {
              to: "/protocol",
              icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
              label: "Protocol",
              sub: "Fact schema reference",
              desc: "21-field reference, decay formula, JSON Schema",
              color: "var(--accent)",
            },
            {
              to: "/skill",
              icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
              label: "Skill",
              sub: "Agent reasoning guide",
              desc: "6 workflow steps, trust thresholds, contradiction rules",
              color: "var(--accent2)",
            },
            {
              to: "/mcp",
              icon: "M5 12h14M12 5l7 7-7 7",
              label: "MCP",
              sub: "Server + tool reference",
              desc: "11 tools · fs / sqlite / duckdb / supabase storage · Claude Desktop, Goose, LM Studio",
              color: "var(--accent4)",
            },
            {
              to: "/examples",
              icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
              label: "Examples",
              sub: "8 domain fact bundles",
              desc: "Loan, IoT, clinical, legal, threat-intel, AI evals + more",
              color: "var(--accent3)",
            },
            {
              to: "/eval",
              icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
              label: "Eval",
              sub: "Scoreboard",
              desc: "33 questions, KNDL vs vanilla, ≥70% required to ship",
              color: "var(--accent)",
            },
          ].map(({ to, icon, label, sub, desc, color }) => (
            <Link key={to} to={to} className={styles.ctaCard}>
              <div className={styles.ctaTop}>
                <svg className={styles.ctaIcon} viewBox="0 0 24 24" fill="none"
                  stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true">
                  <path d={icon} />
                </svg>
                <div>
                  <div className={styles.ctaLabel} style={{ color }}>{label}</div>
                  <div className={styles.ctaSub}>{sub}</div>
                </div>
              </div>
              <div className={styles.ctaDesc}>{desc}</div>
              <div className={styles.ctaArrow} style={{ color }}>Go →</div>
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
