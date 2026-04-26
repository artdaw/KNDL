import { SEO, techArticleSchema } from "../components/SEO";
import styles from "./EvalPage.module.css";

// Placeholder results — run the eval runner to generate real data.
// Format mirrors packages/kndl-memory/eval/results.json
const EVAL_RESULTS = {
  verdict: "NOT_RUN" as "PASS" | "FAIL" | "BORDERLINE" | "NOT_RUN",
  passRate: null as number | null,
  runAt: null as string | null,
  model: null as string | null,
  archetypes: [] as Array<{
    id: string;
    name: string;
    pass: number;
    total: number;
    passRate: number;
  }>,
  questions: [] as Array<{
    id: string;
    archetype: string;
    question: string;
    verdict: "PASS" | "FAIL";
    score: number;
    notes?: string;
  }>,
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const colorMap: Record<string, string> = {
    PASS:        "var(--accent)",
    FAIL:        "var(--accent3)",
    BORDERLINE:  "var(--accent4)",
    NOT_RUN:     "var(--text-dim)",
  };
  return (
    <span className={styles.verdictBadge} style={{ color: colorMap[verdict] ?? "var(--text-dim)", borderColor: colorMap[verdict] ?? "var(--border)" }}>
      {verdict}
    </span>
  );
}

function PassBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 80 ? "var(--accent)" : pct >= 60 ? "var(--accent4)" : "var(--accent3)";
  return (
    <div className={styles.passBarWrap}>
      <div className={styles.passBarTrack}>
        <div className={styles.passBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.passBarPct} style={{ color }}>{pct}%</span>
    </div>
  );
}

export default function EvalPage() {
  const isNotRun = EVAL_RESULTS.verdict === "NOT_RUN";

  return (
    <div className={styles.page}>
      <SEO
        title="KNDL Eval Scoreboard"
        description="Evaluation results for KNDL memory skill. Run the eval suite to generate results showing pass rate, per-archetype breakdown, and per-question verdicts."
        path="/eval"
        type="article"
        keywords="KNDL eval, memory skill evaluation, agent benchmark, fact recall, confidence accuracy"
        jsonLd={techArticleSchema({
          headline: "KNDL Eval Scoreboard",
          description: "Evaluation results for the KNDL memory skill.",
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
            <VerdictBadge verdict={EVAL_RESULTS.verdict} />
          </div>
          <p className={styles.desc}>
            The KNDL eval suite measures whether an agent correctly recalls facts,
            applies decay, resolves contradictions, and cites provenance across
            eight archetypes.
          </p>
        </div>

        {isNotRun ? (
          /* NOT_RUN state */
          <div className={styles.notRunSection}>
            <div className={styles.notRunCard}>
              <div className={styles.notRunIcon}>—</div>
              <div className={styles.notRunTitle}>Eval Not Yet Run</div>
              <p className={styles.notRunDesc}>
                Run the eval suite locally to generate results. The runner calls your
                model with structured prompts and scores the responses against expected
                fact values and confidence ranges.
              </p>
              <div className={styles.codeBlock}>
                <div className={styles.codeLabel}>terminal</div>
                <pre className={styles.pre}>{`# Set your API key
export ANTHROPIC_API_KEY=sk-...

# Run the eval suite
cd packages/kndl-memory
tsx eval/runner.ts

# Results saved to eval/results.json
# Reload this page to see the scoreboard`}</pre>
              </div>
              <div className={styles.notRunFooter}>
                Results are embedded as a static import in this page.
                After running, copy <code className={styles.ic}>eval/results.json</code> content
                into <code className={styles.ic}>EvalPage.tsx</code> to publish the scoreboard.
              </div>
            </div>

            <section className={styles.section}>
              <h2 className={styles.h2}>Archetypes</h2>
              <p className={styles.p}>
                The eval suite tests eight memory archetypes. Each archetype has a set of
                questions that probe specific aspects of the KNDL fact model.
              </p>
              <div className={styles.archetypeGrid}>
                {[
                  { id: "basic-recall",         name: "Basic Recall",           desc: "Does the agent return stored facts when asked directly?" },
                  { id: "decay-aware",           name: "Decay Awareness",        desc: "Does effective_confidence drop correctly over time?" },
                  { id: "supersession",          name: "Supersession",           desc: "Does the agent prefer the newer fact after supersedes?" },
                  { id: "contradiction",         name: "Contradiction Resolution", desc: "Does the agent surface conflicts and pick by confidence?" },
                  { id: "negation",              name: "Negation Handling",      desc: "Does the agent correctly interpret negated:true facts?" },
                  { id: "provenance",            name: "Provenance Citation",    desc: "Does the agent cite source and derivedFrom when asked?" },
                  { id: "classification-gate",   name: "Classification Gates",   desc: "Are PHI/PII facts withheld without consent context?" },
                  { id: "temporal-query",        name: "Temporal Query",         desc: "Can the agent reconstruct past state with as_of queries?" },
                ].map((a) => (
                  <div key={a.id} className={styles.archetypeCard}>
                    <div className={styles.archetypeName}>{a.name}</div>
                    <div className={styles.archetypeDesc}>{a.desc}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          /* Has results state */
          <>
            <section className={styles.section}>
              <h2 className={styles.h2}>Overall</h2>
              <div className={styles.overallRow}>
                <div className={styles.overallStat}>
                  <div className={styles.overallLabel}>Pass Rate</div>
                  {EVAL_RESULTS.passRate !== null && <PassBar rate={EVAL_RESULTS.passRate} />}
                </div>
                <div className={styles.overallStat}>
                  <div className={styles.overallLabel}>Verdict</div>
                  <VerdictBadge verdict={EVAL_RESULTS.verdict} />
                </div>
                {EVAL_RESULTS.model && (
                  <div className={styles.overallStat}>
                    <div className={styles.overallLabel}>Model</div>
                    <code className={styles.modelName}>{EVAL_RESULTS.model}</code>
                  </div>
                )}
                {EVAL_RESULTS.runAt && (
                  <div className={styles.overallStat}>
                    <div className={styles.overallLabel}>Run At</div>
                    <span className={styles.runAt}>{EVAL_RESULTS.runAt}</span>
                  </div>
                )}
              </div>
            </section>

            {EVAL_RESULTS.archetypes.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.h2}>Per-Archetype Breakdown</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Archetype</th>
                        <th>Pass</th>
                        <th>Total</th>
                        <th>Pass Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EVAL_RESULTS.archetypes.map((a) => (
                        <tr key={a.id}>
                          <td className={styles.archetypeNameCell}>{a.name}</td>
                          <td className={styles.numCell}>{a.pass}</td>
                          <td className={styles.numCell}>{a.total}</td>
                          <td><PassBar rate={a.passRate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {EVAL_RESULTS.questions.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.h2}>Per-Question Results</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Archetype</th>
                        <th>Question</th>
                        <th>Score</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EVAL_RESULTS.questions.map((q) => (
                        <tr key={q.id}>
                          <td><code className={styles.qId}>{q.id}</code></td>
                          <td className={styles.qArchetype}>{q.archetype}</td>
                          <td className={styles.qQuestion}>{q.question}</td>
                          <td className={styles.numCell}>{q.score.toFixed(2)}</td>
                          <td><VerdictBadge verdict={q.verdict} /></td>
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
