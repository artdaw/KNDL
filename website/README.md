# KNDL Website

Vite + React 19 + TypeScript documentation site for the KNDL project.

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | LandingPage | Hero, v0.2 feature highlights, quick-start snippet |
| `/spec` | SpecPage | Language reference with 8-domain tabbed examples + live playground |
| `/spec/full` | SpecFullPage | Full rendered SPECIFICATION.md |
| `/workflow` | WorkflowPage | 6-stage agent pipeline animation |
| `/explorer` | ExplorerPage | Force-directed graph explorer (pan/zoom/drag, detail panel) |
| `/mcp` | McpPage | MCP server docs and tool reference |

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
