"""
KNDL Storage — Protocol + factory for pluggable persistence backends.

Configure via DATABASE_URL environment variable (or a .env file):
  (unset / "memory")              → in-memory only, no persistence
  sqlite:///./kndl.db             → SQLite (default, zero deps)
  sqlite:///:memory:              → SQLite in-memory (useful for tests)
  postgresql://user:pw@host/db    → PostgreSQL with JSONB (requires psycopg2)

Example .env:
  DATABASE_URL=sqlite:///./kndl.db
  # DATABASE_URL=postgresql://kndl:secret@localhost:5432/kndl
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from kndl.graph import GraphEdge, GraphIntent, GraphNode


def _load_dotenv() -> None:
    """Load .env from the current working directory (if python-dotenv is installed)."""
    try:
        from dotenv import load_dotenv
        load_dotenv(override=False)     # existing env vars take precedence
    except ImportError:
        pass                            # python-dotenv is optional


@runtime_checkable
class KNDLStorage(Protocol):
    """Pluggable persistence backend for KNDLGraph.

    Implementations must be safe to call from a single thread.
    All write methods should persist immediately (commit on each call).
    """

    def load(
        self,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """Return (node_dicts, edge_dicts, intent_dicts) to warm an empty graph."""
        ...

    def upsert_node(self, node: "GraphNode") -> None: ...
    def delete_node(self, node_id: str) -> None: ...
    def upsert_edge(self, edge: "GraphEdge") -> None: ...
    def delete_edge(self, edge_id: str) -> None: ...
    def upsert_intent(self, intent: "GraphIntent") -> None: ...
    def delete_intent(self, intent_id: str) -> None: ...
    def clear(self) -> None: ...
    def close(self) -> None: ...


def create_storage(database_url: str | None = None) -> "KNDLStorage | None":
    """
    Instantiate a storage backend from a DATABASE_URL string.

    Returns None (no persistence) when DATABASE_URL is absent or "memory".
    Falls back to DATABASE_URL env var when *database_url* is not provided.
    Automatically reads a .env file in the current directory if python-dotenv
    is installed and DATABASE_URL is not already set in the environment.
    """
    if database_url is None:
        _load_dotenv()
        database_url = os.environ.get("DATABASE_URL", "")

    url = database_url
    if not url or url.lower() in ("memory", "none", ""):
        return None

    if url.startswith("sqlite"):
        from kndl.backends.sqlite_backend import SQLiteStorage
        return SQLiteStorage(url)

    if url.startswith("postgresql") or url.startswith("postgres"):
        from kndl.backends.postgres_backend import PostgresStorage
        return PostgresStorage(url)

    raise ValueError(
        f"Unsupported DATABASE_URL: {url!r}\n"
        "Supported schemes: sqlite:///, postgresql://"
    )
