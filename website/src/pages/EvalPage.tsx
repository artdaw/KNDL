import { useState, useEffect } from "react";
import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./EvalPage.module.css";

// ── Types matching packages/kndl-memory/eval/runner.ts output ────────────────

interface QuestionResult {
  scenario_id:      string;
  question_id:      string;
  archetype:        string;
  prompt:           string;
  correct_behavior: string;
  vanilla_answer:   string;
  vanilla_pass:     boolean;
  judge_reasoning:  string;
  eval_date:        string;
  model:            string;
}

interface EvalResults {
  run_at:       string | null;
  model:        string | null;
  total:        number;
  passed:       number;
  failed:       number;
  pass_rate:    number | null;
  threshold:    number;
  verdict:      "PASS" | "FAIL" | "BORDERLINE" | "NOT_RUN";
  by_archetype: Record<string, { total: number; passed: number }>;
  questions:    QuestionResult[];
  note?:        string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  const colorMap: Record<string, string> = {
    PASS:       "var(--accent)",
    FAIL:       "var(--accent3)",
    BORDERLINE: "var(--accent4)",
    NOT_RUN:    "var(--text-dim)",
  };
  const c = colorMap[verdict] ?? "var(--text-dim)";
  return (
    <span className={styles.verdictBadge} style={{ color: c, borderColor: c }}>
      {verdict}
    </span>
  );
}

function PassBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? "var(--accent)" : pct >= 50 ? "var(--accent4)" : "var(--accent3)";
  return (
    <div className={styles.passBarWrap}>
      <div className={styles.passBarTrack}>
        <div className={styles.passBarFill} style={{ width: `${pct}%`, background: color }} />
        <div className={styles.passBarThreshold} title="70% threshold" />
      </div>
      <span className={styles.passBarPct} style={{ color }}>{pct}%</span>
    </div>
  );
}

// ── Archetype descriptions (for NOT_RUN preview) ──────────────────────────────

const ARCHETYPES = [
  { id: "decayed_confidence", name: "Decay Awareness",         desc: "Does effective_confidence drop correctly over time?" },
  { id: "supersession",       name: "Supersession",            desc: "Does the agent prefer the newer fact after supersedes?" },
  { id: "as_of",              name: "Temporal Query",          desc: "Can the agent reconstruct past state with as_of queries?" },
  { id: "contradiction",      name: "Contradiction Resolution",desc: "Does the agent surface conflicts and rank by confidence?" },
  { id: "provenance",         name: "Provenance Citation",     desc: "Does the agent cite source and derivedFrom when asked?" },
  { id: "negation",           name: "Negation Handling",       desc: "Does the agent correctly interpret negated:true facts?" },
  { id: "derivedFrom",        name: "Inference Chain",         desc: "Does the agent acknowledge inferred facts and their confidence?" },
  { id: "composite",          name: "Composite",               desc: "Multi-archetype questions requiring several capabilities at once." },
];

// ── Main component ────────────────────────────────────────────────────────────

export default function EvalPage() {
  const [results, setResults] = useState<EvalResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/eval/results.json")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EvalResults>;
      })
      .then(data => { setResults(data); setLoading(false); })
      .catch(e  => { setError((e as Error).message); setLoading(false); });
  }, []);

  const isNotRun = !results || results.verdict === "NOT_RUN";

  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Eval Scoreboard"
        description="Evaluation results for the KNDL memory skill. 33 questions across 8 archetypes — decay awareness, supersession, contradiction resolution, provenance, temporal queries and more."
        path="/eval"
        type="article"
        keywords="KNDL eval, memory skill evaluation, agent benchmark, fact recall, confidence accuracy, decay"
        jsonLd={techArticleSchema({
          headline: "KNDL Eval Scoreboard",
          description: "Evaluation results for the KNDL memory skill across 8 archetypes.",
          path: "/eval",
        })}
      />
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <div className={styles.tag}>Eval</div>
              <h1 className={styles.title}>Memory Skill Scoreboard</h1>
            </div>
            {!loading && results && <VerdictBadge verdict={results.verdict} />}
          </div>
          <p className={styles.desc}>
            33 binary-scored questions across 8 archetypes. An agent reads KNDL facts pasted
            into the system prompt (vanilla mode) and Claude-as-judge scores the response.
            KNDL must win ≥70% of questions before v2.0 ships.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className={styles.loadingCard}>
            <div className={styles.loadingSpinner} />
            <span>Loading results…</span>
          </div>
        )}

        {/* Fetch error */}
        {error && (
          <div className={styles.errorCard}>
            Could not load <code className={styles.ic}>/eval/results.json</code>: {error}
          </div>
        )}

        {/* NOT_RUN */}
        {!loading && !error && isNotRun && (
          <div className={styles.notRunSection}>
            <div className={styles.notRunCard}>
              <div className={styles.notRunIcon}>—</div>
              <div className={styles.notRunTitle}>Eval Not Yet Run</div>
              <p className={styles.notRunDesc}>
                Run the eval suite to generate results. The runner drives Claude in vanilla mode
                (facts pasted into the system prompt) and uses Claude-as-judge to score each
                response binary PASS/FAIL.
              </p>
              <div className={styles.codeBlock}>
                <div className={styles.codeLabel}>terminal</div>
                <pre className={styles.pre}>{`export ANTHROPIC_API_KEY=sk-ant-...

# Run eval + publish directly to the website
make publish-eval

# Or run manually with a custom output path:
cd packages/kndl-memory
tsx eval/runner.ts --out ../../website/public/eval/results.json

# Redeploy the website to update the scoreboard.`}</pre>
              </div>
              <p className={styles.notRunNote}>
                Results are served from <code className={styles.ic}>/eval/results.json</code>{" "}
                (a static file in <code className={styles.ic}>website/public/eval/</code>).
                No code changes needed — just run the runner and redeploy.
              </p>
            </div>

            <section className={styles.section}>
              <h2 className={styles.h2}>Archetypes tested (8)</h2>
              <div className={styles.archetypeGrid}>
                {ARCHETYPES.map((a) => (
                  <div key={a.id} className={styles.archetypeCard}>
                    <div className={styles.archetypeName}>{a.name}</div>
                    <div className={styles.archetypeDesc}>{a.desc}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Has results */}
        {!loading && !error && results && !isNotRun && (
          <>
            {/* Summary */}
            <section className={styles.section}>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryLabel}>Pass rate</div>
                  <PassBar pct={results.pass_rate ?? 0} />
                  <div className={styles.summaryThresholdNote}>threshold: {results.threshold}%</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryLabel}>Questions</div>
                  <div className={styles.summaryBig}>
                    <span style={{ color: "var(--accent)" }}>{results.passed}</span>
                    <span style={{ color: "var(--text-dim)" }}> / {results.total}</span>
                  </div>
                  <div className={styles.summaryThresholdNote}>{results.failed} failed</div>
                </div>
                <div className={styles.summaryCard}>
                  <div className={styles.summaryLabel}>Verdict</div>
                  <VerdictBadge verdict={results.verdict} />
                </div>
                {results.model && (
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryLabel}>Model</div>
                    <code className={styles.modelName}>{results.model}</code>
                  </div>
                )}
                {results.run_at && (
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryLabel}>Run at</div>
                    <span className={styles.runAt}>{results.run_at.slice(0, 10)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Per-archetype */}
            {Object.keys(results.by_archetype).length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.h2}>Per-archetype breakdown</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Archetype</th><th>Pass</th><th>Total</th><th>Pass rate</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(results.by_archetype).map(([arch, { total, passed }]) => (
                        <tr key={arch}>
                          <td className={styles.archetypeNameCell}>{arch}</td>
                          <td className={styles.numCell}>{passed}</td>
                          <td className={styles.numCell}>{total}</td>
                          <td><PassBar pct={total > 0 ? Math.round(passed / total * 100) : 0} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Per-question */}
            {results.questions.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.h2}>Per-question results</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr><th>ID</th><th>Archetype</th><th>Prompt</th><th>Verdict</th></tr>
                    </thead>
                    <tbody>
                      {results.questions.map((q) => (
                        <tr key={q.question_id}>
                          <td><code className={styles.qId}>{q.question_id}</code></td>
                          <td className={styles.qArchetype}>{q.archetype}</td>
                          <td className={styles.qQuestion} title={q.prompt}>
                            {q.prompt.length > 80 ? q.prompt.slice(0, 78) + "…" : q.prompt}
                          </td>
                          <td><VerdictBadge verdict={q.vanilla_pass ? "PASS" : "FAIL"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

      </div>
    </div>
  );
}
