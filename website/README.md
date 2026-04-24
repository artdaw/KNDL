# KNDL Website

Vite + React 19 + TypeScript documentation site for the KNDL project.

**Live:** https://artdaw.github.io/KNDL/

## Routes

Uses `createBrowserRouter` with a GitHub Pages SPA fallback (`public/404.html` stashes the intended pathname in `sessionStorage`; `main.tsx` replays it on boot). Clean URLs (no `#`) are required for real SEO.

| Path | Page | Description |
|------|------|-------------|
| `/` | LandingPage | Hero, v1.0 feature highlights, quick-start snippet |
| `/spec` | SpecPage | Language reference with 8-domain tabbed examples + live playground |
| `/spec/full` | SpecFullPage | Full rendered SPECIFICATION.md with sticky TOC |
| `/workflow` | WorkflowPage | 6-stage agent pipeline animation (per-stage insight + highlighted layer) |
| `/explorer` | ExplorerPage | Force-directed graph explorer (pan/zoom/drag, detail panel) |
| `/mcp` | McpPage | MCP server docs and tool reference |

## Machine-readable discovery surfaces

Everything below is served as a static file and is meant to be fetched by AI agents, search engines, and scripts.

| URL | Format | Purpose |
|-----|--------|---------|
| `/llms.txt` | markdown | Concise [llmstxt.org](https://llmstxt.org) index of the whole project |
| `/llms-full.txt` | markdown | Spec + EBNF + example index concatenated — single-fetch bundle for LLMs |
| `/spec/SPECIFICATION.md` | markdown | Canonical language reference (mirrored from repo `spec/`) |
| `/spec/kndl.ebnf` | text | Authoritative EBNF grammar (mirrored from repo `spec/grammar/`) |
| `/examples/index.md` | markdown | Index of curated `.kndl` snippets |
| `/examples/*.kndl` | text | Runnable examples (basic-building, intent-overheat, process-shipment, query-aggregation, healthcare-observation, fintech-transaction, robotics-pose, logistics-trace) |
| `/sitemap.xml` | xml | Every indexable URL on the site |
| `/robots.txt` | text | Explicitly allows major AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, …) |
| `/.well-known/security.txt` | text | Security contact per [securitytxt.org](https://securitytxt.org) |

The Vite plugin `kndlSpecAssets` in `vite.config.ts` mirrors `spec/SPECIFICATION.md` and `spec/grammar/kndl.ebnf` from the repo root into the built output at these URLs and serves them in dev. It also regenerates `llms-full.txt` from source on each build.

## SEO per route

`src/components/SEO.tsx` is a tiny runtime component that each page renders. It updates:

- `<title>` and `<meta name="description">`
- `<meta name="robots">` with `max-image-preview:large`
- Open Graph (`og:title`, `og:description`, `og:url`, `og:type`, `og:image`, `og:site_name`)
- Twitter cards (`twitter:*`)
- `<link rel="canonical">` and `<link rel="alternate">` (llm index)
- Per-page JSON-LD (`TechArticle` for docs, `SoftwareSourceCode` for the landing page)

`index.html` also contains a page-level JSON-LD `@graph` covering Organization, WebSite, SoftwareSourceCode, and TechArticle, plus a `<noscript>` pointer to the machine-readable surfaces for crawlers that don't execute JS.

## Stack

| Tool | Version |
|------|---------|
| React | 19.2.5 |
| React Router | 7.14.0 |
| TypeScript | 6.0.2 |
| Vite | 8.0.8 |
| Vitest | 4.1.4 |
| Testing Library | 16.x |

## Prerequisites

- Node.js 18+
- pnpm — `npm i -g pnpm`

## Development

```bash
pnpm install      # install dependencies
pnpm dev          # Vite dev server (hot reload)
pnpm build        # type-check + production build → dist/
pnpm preview      # serve the production build locally
pnpm test         # run Vitest (single pass)
pnpm test:watch   # Vitest in watch mode
pnpm test:ui      # Vitest browser UI
```

Or via the monorepo Makefile from the repo root:

```bash
make web-install
make web-dev
make web-build
```

## Source layout

```
src/
├── main.tsx                   # React entry point
├── App.tsx                    # Router (6 routes)
├── setupTests.ts              # Vitest globals: RAF + ResizeObserver stubs
├── vite-env.d.ts
├── styles/
│   └── tokens.css             # CSS custom properties (colours, fonts, spacing)
├── components/
│   ├── Nav.tsx                # Sticky top nav linking all 6 routes
│   └── CodeBlock.tsx          # Syntax-highlighted KNDL blocks + typewriter animation
├── hooks/
│   └── useForceLayout.ts      # RAF-driven spring-force graph layout (stops at 220 frames)
├── pages/
│   ├── LandingPage.tsx        # v0.2 spec, feature grid, CTA row
│   ├── SpecPage.tsx           # 8-domain tabs, v0.2 meta table, parameterised types, playground
│   ├── SpecFullPage.tsx
│   ├── WorkflowPage.tsx
│   ├── ExplorerPage.tsx       # SVG canvas, force layout, detail panel
│   ├── ExplorerPage.test.tsx  # Component tests
│   └── McpPage.tsx
└── utils/
    ├── kndlParser.ts          # Browser-side KNDL parser (regex-based)
    ├── kndlParser.test.ts     # Unit tests for parseKNDL() and typeColor()
    └── mdRenderer.tsx         # Markdown → React renderer for SpecFullPage
```

## Key implementation notes

- **`kndlParser.ts`** — lightweight regex parser; not the full Python implementation. Exports `parseKNDL(src)`, `typeColor(typeName)`, `TYPE_COLORS`.
- **`useForceLayout.ts`** — spring simulation over `requestAnimationFrame`; preserves node positions across re-renders; terminates after `MAX_ITER = 220` frames.
- **`ExplorerPage.tsx`** — uses `ResizeObserver` to fill available height; SVG viewport supports pan/zoom via pointer events and drag per-node.
- **`SpecPage.tsx`** — domain profile tabs (IoT, FinTech, eCommerce, Logistics, Medicine, Robotics, Smart Factory, Networking) driven by a `DOMAINS` constant; tab state in local `useState`.
- **`setupTests.ts`** — stubs `requestAnimationFrame`, `cancelAnimationFrame`, and `ResizeObserver` for jsdom compatibility.
