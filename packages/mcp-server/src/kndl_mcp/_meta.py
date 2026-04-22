"""Shared utilities for the KNDL MCP server."""

from __future__ import annotations

import re

_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)(ns|us|mo|ms|s|m|h|d|w|y)$")
_DURATION_MULT: dict[str, float] = {
    "ns": 1e-9, "us": 1e-6, "ms": 0.001,
    "s": 1.0, "m": 60.0, "h": 3600.0, "d": 86400.0, "w": 604800.0,
    "mo": 2592000.0, "y": 31536000.0,
}


def _duration_to_seconds(duration_str: str) -> float | None:
    m = _DURATION_RE.match(str(duration_str).strip())
    if not m:
        return None
    return float(m.group(1)) * _DURATION_MULT[m.group(2)]
