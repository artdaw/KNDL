#!/usr/bin/env node
// Post-build prerender for GitHub Pages SEO.
//
// Vite builds a single dist/index.html. Direct hits on /protocol, /skill, etc.
// would otherwise return the 404 fallback (with HTTP 404 status). We stamp
// out one HTML shell per route so each path is served with status 200 and
// the correct <title>, <meta>, <link rel="canonical">, Open Graph, Twitter,
// and JSON-LD already in the markup.
//
// At runtime, the <SEO> component in src/components/SEO.tsx re-applies the
// same values in place (no duplication, no flash) so we stay consistent.
//
// The SEO copy below MUST match the <SEO ... /> props in the corresponding
// page components. Keep them in sync; if they drift, the runtime values
// win but crawlers will see whatever we prerendered here.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const DIST = join(root, "dist");
const ORIGIN = "https://kndl.artdaw.com";
const DEFAULT_IMAGE = `${ORIGIN}/kndl.png`;

// ── Schema.org helpers ────────────────────────────────────────────────────

function techArticle({ headline, description, path, dateModified }) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline,
    description,
    url: ORIGIN + path,
    mainEntityOfPage: ORIGIN + path,
    dateModified: dateModified ?? new Date().toISOString().slice(0, 10),
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "KNDL", url: ORIGIN },
    image: DEFAULT_IMAGE,
  };
}

// ── Route metadata ────────────────────────────────────────────────────────

const ROUTES = [
  {
    path: "/protocol",
    outDir: "protocol",
    title: "KNDL Protocol — Fact Schema Reference",
    description:
      "Field-by-field reference for the KNDL Fact JSON-LD shape. All fields, types, constraints, the decay formula, and JSON Schema link.",
    type: "article",
    keywords:
      "KNDL fact schema, JSON-LD fact, confidence decay, bitemporal facts, provenance, fact format",
    jsonLd: techArticle({
      headline: "KNDL Protocol — Fact Schema Reference",
      description: "Field-by-field reference for the KNDL Fact JSON-LD shape.",
      path: "/protocol",
    }),
  },
  {
    path: "/skill",
    outDir: "skill",
    title: "KNDL Skill — Agent Memory Reasoning Guide",
    description:
      "How AI agents should use KNDL facts: workflow steps, trust thresholds, decay-aware reasoning, contradiction resolution, and provenance citation.",
    type: "article",
    keywords:
      "KNDL skill, agent memory, confidence-aware reasoning, fact decay, provenance chain, contradiction detection",
    jsonLd: techArticle({
      headline: "KNDL Skill — Agent Memory Reasoning Guide",
      description: "How AI agents should use KNDL facts with trust thresholds, decay, and provenance.",
      path: "/skill",
    }),
  },
  {
    path: "/examples",
    outDir: "examples",
    title: "KNDL Examples — 8 Domain Bundles",
    description:
      "Eight real-world KNDL fact bundles: loan decision, IoT sensors, personal memory, threat intelligence, clinical records, legal eDiscovery, scientific lab, and AI evals.",
    type: "article",
    keywords:
      "KNDL examples, fact bundles, loan decision, IoT sensor, clinical records, threat intel, AI evals",
    jsonLd: techArticle({
      headline: "KNDL Examples — 8 Domain Bundles",
      description: "Eight real-world KNDL fact bundles across different domains.",
      path: "/examples",
    }),
  },
  {
    path: "/explorer",
    outDir: "explorer",
    title: "KNDL Explorer — Browse Fact Bundles",
    description:
      "Explore KNDL fact bundles across 8 domains. Visualise confidence, effective decay, supersession chains, provenance, and classification badges in an interactive card view.",
    type: "website",
    keywords:
      "KNDL explorer, fact browser, confidence decay, supersession, provenance, JSON-LD facts",
    jsonLd: techArticle({
      headline: "KNDL Explorer",
      description: "Interactive browser for KNDL fact bundles across 8 domains.",
      path: "/explorer",
    }),
  },
  {
    path: "/mcp",
    outDir: "mcp",
    title: "kndl-memory-mcp — HOW Layer for KNDL Facts",
    description:
      "Install and configure the kndl-memory-mcp server for Claude Desktop, LM Studio, and Goose. Tool reference for assert_fact, query_facts, contradictions, provenance_chain, and remote sync.",
    type: "article",
    keywords:
      "kndl-memory-mcp, MCP server, Claude Desktop, LM Studio, Goose, assert_fact, query_facts, agent memory tools",
    jsonLd: techArticle({
      headline: "kndl-memory-mcp — HOW Layer for KNDL Facts",
      description: "Install and configure the kndl-memory-mcp server. Tool and remote sync reference.",
      path: "/mcp",
    }),
  },
  {
    path: "/eval",
    outDir: "eval",
    title: "KNDL Eval Scoreboard",
    description:
      "Evaluation results for KNDL memory skill. Run the eval suite to generate results showing pass rate, per-archetype breakdown, and per-question verdicts.",
    type: "article",
    keywords:
      "KNDL eval, memory skill evaluation, agent benchmark, fact recall, confidence accuracy",
    jsonLd: techArticle({
      headline: "KNDL Eval Scoreboard",
      description: "Evaluation results for the KNDL memory skill.",
      path: "/eval",
    }),
  },
];

// ── HTML stamping ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setTagContent(html, matcher, replacement) {
  if (!matcher.test(html)) {
    throw new Error(`Prerender: couldn't find tag matching ${matcher}`);
  }
  return html.replace(matcher, replacement);
}

function stamp(template, route) {
  const url = ORIGIN + route.path;
  let html = template;

  html = setTagContent(
    html,
    /<title>[\s\S]*?<\/title>/,
    `<title>${esc(route.title)}</title>`,
  );

  html = setTagContent(
    html,
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${esc(route.description)}" />`,
  );

  html = setTagContent(
    html,
    /<meta name="keywords"[^>]*>/,
    `<meta name="keywords" content="${esc(route.keywords)}" />`,
  );

  html = setTagContent(
    html,
    /<link rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${url}" />`,
  );

  html = setTagContent(
    html,
    /<meta property="og:url"[^>]*>/,
    `<meta property="og:url" content="${url}" />`,
  );
  html = setTagContent(
    html,
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" content="${esc(route.title)}" />`,
  );
  html = setTagContent(
    html,
    /<meta property="og:description"[^>]*>/,
    `<meta property="og:description" content="${esc(route.description)}" />`,
  );
  html = setTagContent(
    html,
    /<meta property="og:type"[^>]*>/,
    `<meta property="og:type" content="${route.type}" />`,
  );

  html = setTagContent(
    html,
    /<meta name="twitter:url"[^>]*>/,
    `<meta name="twitter:url" content="${url}" />`,
  );
  html = setTagContent(
    html,
    /<meta name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
  );
  html = setTagContent(
    html,
    /<meta name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
  );

  // Append per-route JSON-LD right before </head>. The runtime <SEO>
  // component will target the same `data-seo="page"` script tag and
  // overwrite its textContent with the same value on mount.
  if (route.jsonLd) {
    const jsonLdScript = `    <script type="application/ld+json" data-seo="page">${JSON.stringify(
      route.jsonLd,
    )}</script>\n  </head>`;
    html = html.replace(/\s*<\/head>/, `\n${jsonLdScript}`);
  }

  return html;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const template = readFileSync(join(DIST, "index.html"), "utf8");
  let count = 0;
  for (const r of ROUTES) {
    const html = stamp(template, r);
    const outDir = join(DIST, r.outDir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.html"), html);
    count++;
  }
  console.log(`prerender: stamped ${count} route shell${count === 1 ? "" : "s"}`);
  for (const r of ROUTES) {
    console.log(`  ${r.path.padEnd(14)} -> dist/${r.outDir}/index.html`);
  }
}

main();
