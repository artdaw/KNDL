#!/usr/bin/env node
// Post-build prerender for GitHub Pages SEO.
//
// Vite builds a single dist/index.html. Direct hits on /spec, /workflow, etc.
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
    path: "/spec",
    outDir: "spec",
    title: "KNDL Language Specification — types, meta-annotations, domain profiles",
    description:
      "KNDL language reference: primitive types (Quantity, Money, Vector), meta-annotations (~confidence, ~valid, ~recorded, ~negated, ~uncertainty), query language with multi-hop paths, processes, and eight domain profiles (IoT, FinTech, Healthcare, Logistics, Robotics, Smart Factory, Networking, eCommerce).",
    type: "article",
    keywords:
      "KNDL specification, knowledge graph language, AI agent memory, confidence score, temporal decay, provenance, EBNF grammar",
    jsonLd: techArticle({
      headline: "KNDL Language Specification",
      description:
        "Reference for the Knowledge Node Description Language — types, meta-annotations, queries, processes, and domain profiles.",
      path: "/spec",
    }),
  },
  {
    path: "/spec/full",
    outDir: "spec/full",
    title: "KNDL Specification v1.0 — Full Reference",
    description:
      "Full KNDL v1.0 specification: lexical structure, type system (Quantity, Money, Vector, Frame, Code, Localized), core constructs, query language with multi-hop paths, processes, uncertainty model, serialization (text + binary), and conformance levels. Raw markdown available at /spec/SPECIFICATION.md.",
    type: "article",
    keywords:
      "KNDL spec v1.0, EBNF grammar, knowledge graph, agent memory, semantic data, confidence, provenance",
    dateModified: "2026-04-23",
    jsonLd: techArticle({
      headline: "KNDL Language Specification v1.0",
      description: "Complete reference for the Knowledge Node Description Language version 1.0.",
      path: "/spec/full",
      dateModified: "2026-04-23",
    }),
  },
  {
    path: "/workflow",
    outDir: "workflow",
    title: "KNDL Agent Workflow — 6-Stage Pipeline (Ingest → Communicate)",
    description:
      "Walk through how an AI agent actually uses KNDL: Ingest raw input, Produce confidence-scored nodes, Merge into the knowledge graph, Reason with probabilistic queries, Act via intents, Communicate grounded responses. Per-stage insights and integration architecture.",
    type: "article",
    keywords:
      "AI agent workflow, KNDL pipeline, knowledge graph reasoning, intent-action pattern, agent memory",
    jsonLd: techArticle({
      headline: "KNDL Agent Workflow — 6-Stage Pipeline",
      description:
        "How an AI agent uses KNDL as a cognitive substrate across Ingest, Produce, Merge, Reason, Act, and Communicate stages.",
      path: "/workflow",
    }),
  },
  {
    path: "/mcp",
    outDir: "mcp",
    title: "KNDL MCP Server — Use KNDL from Claude & AI Agents",
    description:
      "KNDL MCP server docs: 13 Model Context Protocol tools (kndl_parse, kndl_add_node, kndl_query_nodes, kndl_neighborhood, kndl_add_intent, and more). Install with pip, connect to Claude Desktop or any MCP-compatible agent.",
    type: "article",
    keywords:
      "KNDL MCP, Model Context Protocol, Claude Desktop, AI agent tools, knowledge graph tools, MCP server",
    jsonLd: techArticle({
      headline: "KNDL MCP Server",
      description:
        "Expose the KNDL knowledge graph as Model Context Protocol tools for Claude and other AI agents.",
      path: "/mcp",
    }),
  },
  {
    path: "/explorer",
    outDir: "explorer",
    title: "KNDL Graph Explorer — Interactive Force-Directed Visualization",
    description:
      "Visualise a KNDL knowledge graph live. Edit KNDL source in the browser and watch nodes, typed edges, and confidence scores render as a force-directed graph. Zoom, pan, drag, and inspect node details.",
    type: "website",
    keywords:
      "KNDL graph explorer, knowledge graph visualization, force-directed layout, KNDL playground",
    jsonLd: techArticle({
      headline: "KNDL Graph Explorer",
      description:
        "Interactive force-directed visualization of KNDL knowledge graphs with a live editor.",
      path: "/explorer",
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
