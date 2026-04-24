# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KNDL (Knowledge Node Description Language) is a graph-based knowledge representation format designed for AI agents. Key design principles:

- **Confidence scores** (`~confidence` 0.0–1.0) — every fact carries uncertainty; agents reason probabilistically
- **Temporal decay** (`~decay`) — confidence degrades over time; critical for sensor/IoT data
- **Provenance** (`~source`, `~derived`) — trust can be traced and computed transitively across the graph
- **Intent blocks** — trigger-action patterns native to the format; knowledge and behavior co-located
- **Typed edges** — relationships are first-class with types, direction, and weights
- **Parameterised types** (`Type<Param>`) — generic schemas with type parameters
- **Processes** — state-machine blocks with typed transitions and goto actions
- **Uncertainty distributions** (`~uncertainty Gaussian { ... }`) — full probability distributions

## Repository Structure

```
packages/
  python/        kndl — Python reference implementation (parser → AST → compiler → graph)
  mcp-server/    kndl-mcp — FastMCP server exposing the graph as MCP tools
website/         React + Vite documentation site
spec/            KNDL language specification
.github/         CI (kndl-workflow.yml: python + mcp-server jobs)
```

## Git Conventions

Use **semantic commits**: `type(scope): description`

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(parser): add confidence score parsing`
- `fix(decay): correct time-based degradation formula`
- `docs: update KNDL spec with edge weight examples`

**NEVER include Co-Authored-By in commit messages.**

## Tech Stack

| Package | Language | Tools |
|---------|----------|-------|
| `packages/python` | Python 3.12+ | uv, pytest, ruff, mypy |
| `packages/mcp-server` | Python 3.12+ | uv, FastMCP, pytest, ruff, mypy |
| `website` | TypeScript / React 19 | pnpm, Vite 8, Vitest 4, React Router 7 |

## Python Library (`packages/python`)

Pipeline: `source → Lexer → Parser → AST → Compiler → KNDLGraph → Serializer`

Key modules:
- `lexer.py` — tokeniser
- `parser.py` — recursive-descent parser producing `ast_nodes.py` types
- `compiler.py` — walks AST, populates `KNDLGraph`
- `graph.py` — `KNDLGraph`, `GraphNode`, `GraphEdge`, `GraphIntent`, `KNDLMeta`
- `serializer.py` — graph → KNDL text round-trip
- `storage.py` — SQLite / PostgreSQL backends

Tests: 245 across 5 files (`test_kndl.py`, `test_kndl_extended.py`, `test_storage.py`, `test_processes.py`, `test_advanced_types.py`)

## MCP Server (`packages/mcp-server`)

FastMCP server; all tool functions in `server.py` call into the `kndl` Python library directly.
Transport: `stdio` (Claude Desktop) or `streamable-http` (custom integrations).

Tests: 80 integration tests in `tests/test_tools.py`. Each class uses `autouse` fixture calling `kndl_reset()`.

## Website (`website`)

Six routes: `/` LandingPage · `/spec` SpecPage (domain profiles, playground) · `/spec/full` SpecFullPage · `/workflow` WorkflowPage · `/explorer` ExplorerPage · `/mcp` McpPage

The SpecPage playground is a browser-side mini-parser — not the full Python implementation.
