// stores/index.ts — makeStore factory.
//
// Dispatches on KNDL_STORAGE env var (or explicit url argument).
// Falls back to KNDL_MEMORY_DIR for backwards compatibility with v1.
//
// Formats:
//   fs:./memory                    filesystem (Anthropic Memory mount)
//   sqlite:./kndl.db               SQLite, single-file persistent (DEFAULT)
//   sqlite::memory:                SQLite in-memory (tests)
//   duckdb:./kndl.duckdb           DuckDB, analytical workloads
//   supabase:<url>?key=<anon_key>  Supabase, multi-tenant cloud

import { createRequire } from "node:module";
import type { FactStore } from "../types.js";

const require = createRequire(import.meta.url);

export function makeStore(url?: string): FactStore {
  // Resolve the storage URL: explicit arg > env var > legacy KNDL_MEMORY_DIR > default
  const raw = url
    ?? process.env.KNDL_STORAGE
    ?? (process.env.KNDL_MEMORY_DIR ? `fs:${process.env.KNDL_MEMORY_DIR}` : null)
    ?? "fs:./memory";

  if (raw.startsWith("fs:")) {
    const { FsFactStore } = require("./fs.js") as typeof import("./fs.js");
    return new FsFactStore(raw.slice(3));
  }

  if (raw.startsWith("sqlite:")) {
    const { SqliteFactStore } = require("./sqlite.js") as typeof import("./sqlite.js");
    return new SqliteFactStore(raw.slice(7));
  }

  if (raw.startsWith("duckdb:")) {
    const { DuckDbFactStore } = require("./duckdb.js") as typeof import("./duckdb.js");
    return new DuckDbFactStore(raw.slice(7));
  }

  if (raw.startsWith("supabase:")) {
    // supabase:<url>?key=<anon_key>
    const rest = raw.slice(9);
    const qIdx = rest.lastIndexOf("?key=");
    if (qIdx === -1) throw new Error("supabase: URL must include ?key=<anon_key>");
    const supabaseUrl = rest.slice(0, qIdx);
    const supabaseKey = rest.slice(qIdx + 5);
    const { SupabaseFactStore } = require("./supabase.js") as typeof import("./supabase.js");
    return new SupabaseFactStore(supabaseUrl, supabaseKey);
  }

  throw new Error(`Unknown KNDL_STORAGE scheme: ${raw}\nSupported: fs:, sqlite:, duckdb:, supabase:`);
}

export type { FactStore } from "../types.js";
export { FsFactStore } from "./fs.js";
export { SqliteFactStore } from "./sqlite.js";
