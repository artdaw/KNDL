.PHONY: help \
        py-install py-test py-test-cov py-lint py-build \
		mcp-install mcp-run mcp-run-http mcp-test \
        install build test lint clean

# ── Default: list targets ─────────────────────────────────────────────────────
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

# ── Python library ────────────────────────────────────────────────────────────
py-install: ## Install Python library deps
	cd packages/python && uv sync --all-extras

py-test: ## Run Python tests
	cd packages/python && uv run pytest -v

py-test-cov: ## Run Python tests with coverage
	cd packages/python && uv run pytest --cov=src/kndl --cov-report=term-missing

py-lint: ## Lint Python (ruff + mypy)
	cd packages/python && uv run ruff check src tests && uv run mypy src

py-build: ## Build Python wheel
	cd packages/python && uv build

# ── MCP server ────────────────────────────────────────────────────────────────
mcp-install: ## Install MCP server deps
	cd packages/mcp-server && uv sync --all-extras

mcp-run: ## Start MCP server (stdio)
	cd packages/mcp-server && uv run python -m kndl_mcp

mcp-run-http: ## Start MCP server (HTTP, port 8000)
	cd packages/mcp-server && uv run python -m kndl_mcp --http

mcp-lint: ## Lint MCP (ruff + mypy)
	cd packages/mcp-server && uv run ruff check src tests && uv run mypy src

mcp-test: ## Run MCP integration tests
	cd packages/mcp-server && uv run pytest -v

# ── Aggregates ────────────────────────────────────────────────────────────────
install: py-install mcp-install ## Install all packages

build: py-build ## Build all packages

test: py-test mcp-test ## Run all test suites

lint: py-lint mcp-lint ## Run all linters

clean: ## Remove build artifacts and venvs
	cd packages/python     && rm -rf dist .venv
	cd packages/mcp-server && rm -rf dist .venv
