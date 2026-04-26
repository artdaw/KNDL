.PHONY: help \
        kndl-install kndl-build kndl-test kndl-lint kndl-eval \
        web-install web-dev web-build web-preview \
        mcp-run mcp-run-http \
        install build test clean

NODE = node
PNPM = pnpm

# ── Default: list targets ─────────────────────────────────────────────────────
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-22s %s\n", $$1, $$2}'

# ── @kndl/memory package ──────────────────────────────────────────────────────
kndl-install: ## Install @kndl/memory deps
	cd packages/kndl-memory && $(PNPM) install

kndl-build: ## Build @kndl/memory (ESM + type declarations)
	cd packages/kndl-memory && $(PNPM) run build

kndl-test: ## Run @kndl/memory tests (stores + remote, 36 tests)
	cd packages/kndl-memory && $(PNPM) test

kndl-lint: ## Type-check @kndl/memory
	cd packages/kndl-memory && npx tsc --noEmit

kndl-eval: ## Run eval and publish results to website/public/eval/results.json
	cd packages/kndl-memory && npx tsx eval/runner.ts \
	  --out ../../website/public/eval/results.json

publish-eval: kndl-eval web-build ## Run eval, publish results, build website

# ── MCP server ────────────────────────────────────────────────────────────────
mcp-run: ## Start kndl-memory-mcp (stdio, default storage)
	cd packages/kndl-memory && $(NODE) dist/server.js

mcp-run-http: ## Start kndl-memory-mcp (HTTP port 8000, DEBUG logging)
	cd packages/kndl-memory && LOG_LEVEL=DEBUG $(NODE) dist/server.js --http

# ── Website ───────────────────────────────────────────────────────────────────
web-install: ## Install website deps
	cd website && $(PNPM) install

web-dev: ## Start Vite dev server
	cd website && $(PNPM) run dev

web-build: ## Build website for production
	cd website && $(PNPM) run build

web-preview: ## Preview production build
	cd website && $(PNPM) run preview

# ── Aggregates ────────────────────────────────────────────────────────────────
install: kndl-install web-install ## Install all packages

build: kndl-build web-build ## Build all packages

test: kndl-test ## Run all tests

clean: ## Remove build artifacts and node_modules
	cd packages/kndl-memory && rm -rf dist node_modules
	cd website             && rm -rf dist node_modules
