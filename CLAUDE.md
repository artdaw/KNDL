# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KNDL (Knowledge Node Description Language) is a graph-based knowledge representation format designed for AI agents. Key design principles from the spec:

- **Confidence scores** (`~confidence` 0.0–1.0) — every fact carries uncertainty, agents reason probabilistically
- **Temporal decay** (`~decay`) — confidence degrades over time, critical for sensor/IoT data
- **Provenance** (`~source`, `~derived`) — trust can be traced and computed transitively across the graph
- **Intent blocks** — trigger-action patterns native to the format (knowledge + behavior co-located)
- **Typed edges** — relationships are first-class with types and weights

## Git Conventions

Use **semantic commits**: `type(scope): description`

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(parser): add confidence score parsing`
- `fix(decay): correct time-based degradation formula`
- `docs: update KNDL spec with edge weight examples`

## Planned Tech Stack

The `.gitignore` indicates three potential implementation targets:
- **Python** — likely parser/runtime (pytest for tests, ruff for linting, mypy for types)
- **Kotlin/Gradle** — likely JVM implementation
- **Node/Astro** — likely documentation website
