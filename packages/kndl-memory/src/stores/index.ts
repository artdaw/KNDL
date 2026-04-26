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

// FsFactStore and SqliteFactStore are statically imported so tsup bundles them
// into the main chunk — avoids ERR_MODULE_NOT_FOUND from hashed chunk filenames.
// DuckDb and Supabase remain lazily required (optional packages; fail gracefully
// when the npm package is not installed).
import { createRequire } from "node:module";
import { FsFactStore } from "./fs.js";
import { SqliteFactStore } from "./sqlite.js";
import type { FactStore } from "../types.js";

const _require = createRequire(import.meta.url);

export function makeStore(url?: string): FactStore {
  // Resolve the storage URL: explicit arg > env var > legacy KNDL_MEMORY_DIR > default
  const raw = url
    ?? process.env.KNDL_STORAGE
    ?? (process.env.KNDL_MEMORY_DIR ? `fs:${process.env.KNDL_MEMORY_DIR}` : null)
    ?? "fs:./memory";

  if (raw.startsWith("fs:"))     return new FsFactStore(raw.slice(3));
  if (raw.startsWith("sqlite:")) return new SqliteFactStore(raw.slice(7));

  if (raw.startsWith("duckdb:")) {
    // Optional: requires `npm install @duckdb/node-api`
    const { DuckDbFactStore } = _require("./duckdb.js") as typeof import("./duckdb.js");
    return new DuckDbFactStore(raw.slice(7));
  }

  if (raw.startsWith("supabase:")) {
    // Optional: requires `npm install @supabase/supabase-js`
    const rest = raw.slice(9);
    const qIdx = rest.lastIndexOf("?key=");
    if (qIdx === -1) throw new Error("supabase: URL must include ?key=<anon_key>");
    const supabaseUrl = rest.slice(0, qIdx);
    const supabaseKey = rest.slice(qIdx + 5);
    const { SupabaseFactStore } = _require("./supabase.js") as typeof import("./supabase.js");
    return new SupabaseFactStore(supabaseUrl, supabaseKey);
  }

  throw new Error(`Unknown KNDL_STORAGE scheme: ${raw}\nSupported: fs:, sqlite:, duckdb:, supabase:`);
}

export type { FactStore } from "../types.js";
export { FsFactStore } from "./fs.js";
export { SqliteFactStore } from "./sqlite.js";
