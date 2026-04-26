#!/usr/bin/env tsx
// eval/runner.ts — KNDL eval runner.
//
// Drives Claude in vanilla mode (facts pasted into system prompt) and uses
// Claude-as-judge to auto-score each response binary right/wrong.
//
// MCP mode (facts accessed via kndl-memory-mcp tools) is documented below
// but requires a running server; run that side manually for now.
//
// Usage:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   tsx eval/runner.ts [--scenario <id>] [--out results.json]
//
// Output: JSON to stdout + summary to stderr.
//         Saves to --out path if provided (default: eval/results.json).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  archetype: string;
  prompt: string;
  correct_behavior: string;
  vanilla_failure_mode: string;
  setup_note?: string;
}

interface Scenario {
  id: string;
  name: string;
  corpus_dir: string;
  eval_date: string;
  questions: Question[];
}

interface EvalSuite {
  version: string;
  scenarios: Scenario[];
}

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
  run_at:     string;
  model:      string;
  total:      number;
  passed:     number;
  failed:     number;
  pass_rate:  number;
  threshold:  number;
  verdict:    "PASS" | "FAIL" | "BORDERLINE";
  by_archetype: Record<string, { total: number; passed: number }>;
  questions:  QuestionResult[];
}

// ── Corpus loader ─────────────────────────────────────────────────────────────

const SKILLS_DIR = resolve(new URL(".", import.meta.url).pathname, "../../../skills/kndl-memory");
const EVAL_DIR   = join(SKILLS_DIR, "eval");
const SUITE_PATH = join(EVAL_DIR, "questions.json");

function loadCorpus(corpusDir: string): string {
  const dir = join(SKILLS_DIR, corpusDir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".fact.json"));
  } catch {
    return `(no corpus found at ${corpusDir})`;
  }
  const facts = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  return JSON.stringify(facts, null, 2);
}

// ── Scoring (Claude-as-judge) ─────────────────────────────────────────────────

const JUDGE_PROMPT = (question: string, correctBehavior: string, vanillaFailure: string, answer: string) => `\
You are scoring an AI answer on a knowledge-representation question.

QUESTION:
${question}

CORRECT BEHAVIOR:
${correctBehavior}

TYPICAL VANILLA FAILURE MODE:
${vanillaFailure}

AI ANSWER:
${answer}

Score the answer. Answer with EXACTLY one of:
PASS — the answer exhibits the correct behavior (may be worded differently but hits the key points)
FAIL — the answer exhibits the vanilla failure mode or otherwise misses the key points

Then on the next line, one sentence explaining your score.`;

async function judgeAnswer(
  client: Anthropic,
  model: string,
  q: Question,
  answer: string,
): Promise<{ pass: boolean; reasoning: string }> {
  const resp = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: JUDGE_PROMPT(q.prompt, q.correct_behavior, q.vanilla_failure_mode, answer),
    }],
  });

  const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  const pass  = text.toUpperCase().startsWith("PASS");
  const lines = text.split("\n");
  const reasoning = lines.slice(1).join(" ").trim() || text;
  return { pass, reasoning };
}

// ── Vanilla evaluation ────────────────────────────────────────────────────────

async function evalVanilla(
  client: Anthropic,
  model: string,
  scenario: Scenario,
  question: Question,
): Promise<{ answer: string; pass: boolean; reasoning: string }> {
  const corpus = loadCorpus(scenario.corpus_dir);
  const system = `\
You are an AI assistant with access to structured memory facts about ${scenario.name}.
Today's date for evaluation purposes is ${scenario.eval_date}.
${question.setup_note ? `\nNote: ${question.setup_note}\n` : ""}
Here are the memory facts (JSON-LD format):

${corpus}

Answer questions based ONLY on these facts. Apply confidence scores, decay, and provenance as appropriate.`;

  const resp = await client.messages.create({
    model,
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: question.prompt }],
  });

  const answer = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  const { pass, reasoning } = await judgeAnswer(client, model, question, answer);
  return { answer, pass, reasoning };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write("error: ANTHROPIC_API_KEY not set\n");
    process.exit(1);
  }

  const args = process.argv.slice(2);

  // Safe flag parsing: indexOf returns -1 when absent; -1+1=0 reads the wrong value.
  function flag(name: string): string | null {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  }

  const scenarioFilter = flag("--scenario");
  const outPath        = flag("--out") ?? join(EVAL_DIR, "results.json");
  // Default to claude-sonnet-4-6 — cost-effective for eval workloads.
  // Override with --model claude-opus-4-7 for highest accuracy.
  const model          = flag("--model") ?? "claude-sonnet-4-6";

  const suite   = JSON.parse(readFileSync(SUITE_PATH, "utf8")) as EvalSuite;
  const client  = new Anthropic({ apiKey });

  const results: QuestionResult[] = [];
  const byArchetype: Record<string, { total: number; passed: number }> = {};

  const scenarios = scenarioFilter
    ? suite.scenarios.filter((s) => s.id === scenarioFilter)
    : suite.scenarios;

  for (const scenario of scenarios) {
    process.stderr.write(`\n▶ ${scenario.name} (${scenario.questions.length} questions)\n`);
    for (const q of scenario.questions) {
      process.stderr.write(`  ${q.id} (${q.archetype})… `);
      try {
        const { answer, pass, reasoning } = await evalVanilla(client, model, scenario, q);
        results.push({
          scenario_id:      scenario.id,
          question_id:      q.id,
          archetype:        q.archetype,
          prompt:           q.prompt,
          correct_behavior: q.correct_behavior,
          vanilla_answer:   answer,
          vanilla_pass:     pass,
          judge_reasoning:  reasoning,
          eval_date:        scenario.eval_date,
          model,
        });
        if (!byArchetype[q.archetype]) byArchetype[q.archetype] = { total: 0, passed: 0 };
        byArchetype[q.archetype].total++;
        if (pass) byArchetype[q.archetype].passed++;
        process.stderr.write(pass ? "✔ PASS\n" : "✖ FAIL\n");
      } catch (e) {
        process.stderr.write(`ERROR: ${(e as Error).message}\n`);
        results.push({
          scenario_id: scenario.id, question_id: q.id, archetype: q.archetype,
          prompt: q.prompt, correct_behavior: q.correct_behavior,
          vanilla_answer: `[error: ${(e as Error).message}]`,
          vanilla_pass: false, judge_reasoning: "eval error",
          eval_date: scenario.eval_date, model,
        });
      }
      // Rate limiting: small pause between calls
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const total     = results.length;
  const passed    = results.filter((r) => r.vanilla_pass).length;
  const passRate  = total > 0 ? passed / total : 0;
  const THRESHOLD = 0.7;
  const verdict   = passRate >= THRESHOLD ? "PASS" : passRate >= THRESHOLD - 0.1 ? "BORDERLINE" : "FAIL";

  const output: EvalResults = {
    run_at:   new Date().toISOString(),
    model,
    total, passed, failed: total - passed,
    pass_rate:  Math.round(passRate * 1000) / 10,
    threshold:  THRESHOLD * 100,
    verdict,
    by_archetype: byArchetype,
    questions: results,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));

  process.stderr.write(`\n${"─".repeat(50)}\n`);
  process.stderr.write(`Total: ${total} | Pass: ${passed} | Fail: ${total - passed}\n`);
  process.stderr.write(`Pass rate: ${output.pass_rate}% (threshold: ${THRESHOLD * 100}%)\n`);
  process.stderr.write(`Verdict: ${verdict}\n`);
  if (verdict === "FAIL") {
    process.stderr.write(`\n⚠ KNDL did not beat vanilla on ≥70% of questions.\n`);
    process.stderr.write(`Per v2.md §13: fix the protocol before shipping v2.0.\n`);
  }
  process.stderr.write(`Results saved to: ${outPath}\n`);

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exit(verdict === "FAIL" ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
