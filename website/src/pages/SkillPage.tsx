import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./SkillPage.module.css";

const WORKFLOW_STEPS = [
  {
    n: "01",
    title: "Before Answering",
    action: "query_facts",
    desc: "Call query_facts with the topic before answering any question. If facts exist and effective_confidence >= 0.5, lead with what you know. If confidence < 0.5 due to decay, acknowledge uncertainty.",
  },
  {
    n: "02",
    title: "Before Stating a New Fact",
    action: "assert_fact",
    desc: "When you learn something new or significant, call assert_fact with a structured Fact object. Set confidence honestly — self-reported human claims warrant 0.7–0.9, verified lab data warrants 0.95–0.99. Add decay if the fact goes stale.",
  },
  {
    n: "03",
    title: "When Learning Updates an Old Fact",
    action: "assert_fact + supersedes",
    desc: "Call assert_fact and set supersedes to the old fact's @id. The old fact is retained for audit. The new fact takes precedence in future queries. Do not delete old facts.",
  },
  {
    n: "04",
    title: "Time-Travel Queries",
    action: "query_facts(as_of=T)",
    desc: "Use the as_of parameter to reconstruct the world at a past time. This lets you answer 'what did we know in March?' without destroying current knowledge.",
  },
  {
    n: "05",
    title: "Provenance Chain",
    action: "provenance_chain",
    desc: "Call provenance_chain(fact_id) to surface derivedFrom and supersedes links. Show the chain to the user when they ask 'how do you know that?' or when confidence < 0.7.",
  },
  {
    n: "06",
    title: "Contradiction Detection",
    action: "contradictions",
    desc: "Call contradictions() before making recommendations that depend on conflicting facts. Present the conflict to the user with confidence values and sources. Do not silently pick one.",
  },
];

const TRUST_THRESHOLDS = [
  { range: "0.9 – 1.0", label: "High",         action: "State directly. No hedging needed.",                          color: "var(--accent)" },
  { range: "0.7 – 0.9", label: "Medium-High",   action: "State with soft qualifier: 'as of last check'.",             color: "var(--accent)" },
  { range: "0.5 – 0.7", label: "Medium",         action: "Flag uncertainty: 'confidence is moderate, verify if critical'.", color: "var(--accent4)" },
  { range: "0.3 – 0.5", label: "Low",            action: "Present as tentative. Offer to look for a better source.",  color: "var(--accent4)" },
  { range: "0.0 – 0.3", label: "Very Low",       action: "Do not use without explicit user awareness. Flag as unreliable.", color: "var(--accent3)" },
];

const REASONING_RULES = [
  "Trust thresholds — always use effective_confidence (post-decay), not raw confidence.",
  "Contradiction resolution — when two facts assert conflicting values for the same predicate and subject, prefer the one with higher effective_confidence. If within 0.1 of each other, report both.",
  "Negation handling — a fact with negated:true asserts the ABSENCE of the object. Do not treat as positive evidence.",
  "Always cite facts — when using a stored fact to answer, name it: 'Based on a fact recorded on <validFrom>...'",
  "Classification gates — do not expose PHI or PII facts in responses unless the session has declared appropriate consent context.",
  "Retention awareness — facts with a retention field must not be purged before the retention period expires, even if superseded.",
];

// Decay table: rate × window → confidence after 1d / 7d / 30d
const DECAY_TABLE = [
  { spec: "0.5/1h",   after1d: (0.9 * Math.pow(0.5, 24/1)).toFixed(4),    after7d: "~0",   after30d: "~0" },
  { spec: "0.5/24h",  after1d: (0.9 * Math.pow(0.5, 24/24)).toFixed(3),   after7d: (0.9 * Math.pow(0.5, 168/24)).toFixed(3), after30d: "~0" },
  { spec: "0.5/7d",   after1d: (0.9 * Math.pow(0.5, 1/7)).toFixed(3),     after7d: (0.9 * Math.pow(0.5, 7/7)).toFixed(3),   after30d: (0.9 * Math.pow(0.5, 30/7)).toFixed(3) },
  { spec: "0.5/30d",  after1d: (0.9 * Math.pow(0.5, 1/30)).toFixed(3),    after7d: (0.9 * Math.pow(0.5, 7/30)).toFixed(3),  after30d: (0.9 * Math.pow(0.5, 30/30)).toFixed(3) },
  { spec: "0.5/90d",  after1d: (0.9 * Math.pow(0.5, 1/90)).toFixed(3),    after7d: (0.9 * Math.pow(0.5, 7/90)).toFixed(3),  after30d: (0.9 * Math.pow(0.5, 30/90)).toFixed(3) },
  { spec: "0.5/365d", after1d: (0.9 * Math.pow(0.5, 1/365)).toFixed(3),   after7d: (0.9 * Math.pow(0.5, 7/365)).toFixed(3), after30d: (0.9 * Math.pow(0.5, 30/365)).toFixed(3) },
];

function confColor(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n) || val === "~0") return "var(--accent3)";
  if (n >= 0.7) return "var(--accent)";
  if (n >= 0.4) return "var(--accent4)";
  return "var(--accent3)";
}

export default function SkillPage() {
  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Skill — Agent Memory Reasoning Guide"
        description="How AI agents should use KNDL facts: workflow steps, trust thresholds, decay-aware reasoning, contradiction resolution, and provenance citation."
        path="/skill"
        type="article"
        keywords="KNDL skill, agent memory, confidence-aware reasoning, fact decay, provenance chain, contradiction detection"
        jsonLd={techArticleSchema({
          headline: "KNDL Skill — Agent Memory Reasoning Guide",
          description: "How AI agents should use KNDL facts with trust thresholds, decay, and provenance.",
          path: "/skill",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.tag}>Skill</div>
          <h1 className={styles.title}>Agent Reasoning with KNDL Memory</h1>
          <p className={styles.desc}>
            This page describes how an AI agent should use the KNDL memory tools — not just
            to store and retrieve facts, but to reason about confidence, decay, contradiction,
            and provenance in a principled way.
          </p>
        </div>

        {/* Summary card */}
        <section className={styles.section}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>What the Skill Does</div>
            <p className={styles.summaryText}>
              The KNDL Skill teaches agents to treat memory as a probabilistic, time-bounded
              knowledge base rather than a flat notepad. Agents check memory before answering,
              write structured facts when learning, supersede stale facts, detect contradictions,
              and cite provenance — all in a single consistent discipline.
            </p>
            <div className={styles.summaryPills}>
              {["assert_fact", "query_facts", "contradictions", "provenance_chain", "supersedes", "decay"].map(p => (
                <span key={p} className={styles.pill}>{p}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Download + CLI install */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Download &amp; Install</h2>

          {/* Step 1 — CLI */}
          <div className={styles.installStep}>
            <div className={styles.installStepNum}>1</div>
            <div className={styles.installStepBody}>
              <div className={styles.installStepTitle}>Install the <code className={styles.ic}>kndl</code> CLI</div>
              <p className={styles.installStepDesc}>
                The Skill relies on the <code className={styles.ic}>kndl</code> binary to read and write
                facts. Build it from source and link it globally so the agent can call it from any directory.
              </p>
              <pre className={styles.installCode}>{`git clone https://github.com/artdaw/kndl
cd kndl/packages/kndl-memory
pnpm install && pnpm build
npm link          # makes \`kndl\` available globally

# Verify
kndl help`}</pre>
              <p className={styles.installStepNote}>
                Set <code className={styles.ic}>KNDL_STORAGE</code> to tell the CLI where facts live:{" "}
                <code className={styles.ic}>fs:/memory</code> for an Anthropic Memory mount, or{" "}
                <code className={styles.ic}>sqlite:./kndl-memory.db</code> for Claude Desktop.
              </p>
            </div>
          </div>

          {/* Step 2 — Skill files */}
          <div className={styles.installStep}>
            <div className={styles.installStepNum}>2</div>
            <div className={styles.installStepBody}>
              <div className={styles.installStepTitle}>Drop the Skill bundle into your memory store</div>
              <p className={styles.installStepDesc}>
                Download both files and place them in your agent's skills directory.
                The context file is also served at{" "}
                <code className={styles.ic}>https://kndl.artdaw.com/context/v1.jsonld</code>{" "}
                so you can reference it by URL instead of vendoring locally.
              </p>
              <div className={styles.downloadCard}>
                <div className={styles.downloadInfo}>
                  <div className={styles.downloadTree}>
                    <span className={styles.treeDir}>/memory/skills/</span>
                    <span className={styles.treeFile}>├── SKILL.md</span>
                    <span className={styles.treeDir}>└── context/</span>
                    <span className={styles.treeFile}>&nbsp;&nbsp;&nbsp;&nbsp;└── v1.jsonld</span>
                  </div>
                </div>
                <div className={styles.downloadButtons}>
                  <a href="/skill/SKILL.md" download="SKILL.md" className={styles.downloadBtn}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    SKILL.md
                  </a>
                  <a href="/context/v1.jsonld" download="v1.jsonld" className={styles.downloadBtn}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    context/v1.jsonld
                  </a>
                </div>
              </div>
            </div>
          </div>

        </section>

        {/* Workflow steps */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Workflow Steps</h2>
          <div className={styles.stepList}>
            {WORKFLOW_STEPS.map((s) => (
              <div key={s.n} className={styles.step}>
                <div className={styles.stepNum}>{s.n}</div>
                <div className={styles.stepBody}>
                  <div className={styles.stepHeader}>
                    <div className={styles.stepTitle}>{s.title}</div>
                    <code className={styles.stepAction}>{s.action}</code>
                  </div>
                  <p className={styles.stepDesc}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Trust thresholds */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Trust Thresholds</h2>
          <p className={styles.p}>
            Use <strong>effective_confidence</strong> (post-decay), not raw confidence.
            The formula is <code className={styles.ic}>base × rate^(elapsed/window)</code>.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Effective confidence</th>
                  <th>Label</th>
                  <th>Agent action</th>
                </tr>
              </thead>
              <tbody>
                {TRUST_THRESHOLDS.map((t) => (
                  <tr key={t.range}>
                    <td>
                      <span className={styles.confRange} style={{ color: t.color }}>{t.range}</span>
                    </td>
                    <td>
                      <span className={styles.confLabel} style={{ color: t.color }}>{t.label}</span>
                    </td>
                    <td className={styles.confAction}>{t.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Reasoning rules */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Reasoning Rules</h2>
          <ol className={styles.ruleList}>
            {REASONING_RULES.map((r, i) => (
              <li key={i} className={styles.ruleItem}>{r}</li>
            ))}
          </ol>
        </section>

        {/* Decay table */}
        <section className={styles.section}>
          <h2 className={styles.h2}>Decay Reference Table</h2>
          <p className={styles.p}>
            Base confidence 0.9 across all specs. Values show effective confidence after
            the specified elapsed time.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Decay spec</th>
                  <th>After 1 day</th>
                  <th>After 7 days</th>
                  <th>After 30 days</th>
                </tr>
              </thead>
              <tbody>
                {DECAY_TABLE.map((d) => (
                  <tr key={d.spec}>
                    <td><code className={styles.decaySpec}>{d.spec}</code></td>
                    <td style={{ color: confColor(d.after1d), fontFamily: "var(--font-mono)", fontSize: "13px" }}>{d.after1d}</td>
                    <td style={{ color: confColor(d.after7d), fontFamily: "var(--font-mono)", fontSize: "13px" }}>{d.after7d}</td>
                    <td style={{ color: confColor(d.after30d), fontFamily: "var(--font-mono)", fontSize: "13px" }}>{d.after30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
