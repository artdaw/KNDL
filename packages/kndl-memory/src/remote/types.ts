// remote/types.ts — interfaces for the Anthropic Memory Stores API.
// Spec: https://platform.claude.com/docs/en/api/go/beta/memory_stores

// ── Domain types ──────────────────────────────────────────────────────────────

export interface MemoryStore {
  id: string;
  type: "memory_store";
  name: string;
  description?: string;
  metadata?: Record<string, string>;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface DeletedMemoryStore {
  id: string;
  type: "memory_store_deleted";
}

export interface Memory {
  id: string;
  type: "memory";
  path: string;
  content?: string;          // present when view=full
  content_sha256: string;
  content_size_bytes: number;
  memory_store_id: string;
  memory_version_id: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryPrefix {
  path: string;
  type: "memory_prefix";
}

export type MemoryListItem = Memory | MemoryPrefix;

export interface DeletedMemory {
  id: string;
  type: "memory_deleted";
}

export type Actor =
  | { type: "session_actor"; session_id: string }
  | { type: "api_actor";     api_key_id: string }
  | { type: "user_actor";    user_id: string };

export interface MemoryVersion {
  id: string;
  type: "memory_version";
  memory_id: string;
  memory_store_id: string;
  operation: "created" | "modified" | "deleted";
  path: string;
  content?: string;
  content_sha256: string;
  content_size_bytes: number;
  created_at: string;
  created_by?: Actor;
  redacted_at?: string;
  redacted_by?: Actor;
}

export interface PagedResult<T> {
  data: T[];
  next_page?: string;   // cursor for the next page
  has_more: boolean;
}

// ── Client interface ──────────────────────────────────────────────────────────

export interface ListStoresOptions {
  include_archived?: boolean;
  limit?: number;
  page?: string;
}

export interface ListMemoriesOptions {
  path_prefix?: string;
  limit?: number;
  page?: string;
  order?: "asc" | "desc";
  view?: "basic" | "full";
}

export interface ListVersionsOptions {
  memory_id?: string;
  operation?: "created" | "modified" | "deleted";
  limit?: number;
  page?: string;
}

export interface MemoryStoreClient {
  // ── Store CRUD ──────────────────────────────────────────────────────────────
  createStore(name: string, opts?: { description?: string; metadata?: Record<string, string> }): Promise<MemoryStore>;
  listStores(opts?: ListStoresOptions): Promise<PagedResult<MemoryStore>>;
  getStore(storeId: string): Promise<MemoryStore | null>;
  updateStore(storeId: string, opts: { name?: string; description?: string; metadata?: Record<string, string> }): Promise<MemoryStore>;
  deleteStore(storeId: string): Promise<DeletedMemoryStore>;
  archiveStore(storeId: string): Promise<MemoryStore>;

  // ── Memory CRUD ─────────────────────────────────────────────────────────────
  createMemory(storeId: string, path: string, content: string): Promise<Memory>;
  listMemories(storeId: string, opts?: ListMemoriesOptions): Promise<PagedResult<MemoryListItem>>;
  getMemory(storeId: string, memoryId: string, view?: "basic" | "full"): Promise<Memory | null>;
  updateMemory(storeId: string, memoryId: string, opts: { content?: string; path?: string; precondition?: { content_sha256: string } }): Promise<Memory>;
  deleteMemory(storeId: string, memoryId: string, opts?: { expected_content_sha256?: string }): Promise<DeletedMemory>;

  // ── Memory Versions ─────────────────────────────────────────────────────────
  listVersions(storeId: string, opts?: ListVersionsOptions): Promise<PagedResult<MemoryVersion>>;
  getVersion(storeId: string, versionId: string): Promise<MemoryVersion | null>;
  redactVersion(storeId: string, versionId: string): Promise<MemoryVersion>;
}

/** @deprecated Use MemoryStore, Memory, etc. instead. Kept for internal compat. */
export interface MemoryStoreItem {
  id: string;
  store_id: string;
  content: string;
  created_at: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

/** A configured remote store registered locally. */
export interface RemoteConfig {
  label: string;
  provider: "anthropic";
  store_id: string;
  default_confidence: number;   // default 0.85
  last_synced_at?: string;      // ISO datetime watermark
  last_cursor?: string;         // pagination cursor from last pull
  push: boolean;                // false in v2.0
  push_tag?: string;
}

export interface RemotesFile {
  remotes: RemoteConfig[];
}

/** Result of a sync pull. */
export interface SyncResult {
  store_id: string;
  label: string;
  pulled: number;        // new facts written
  skipped: number;       // items already up-to-date
  superseded: number;    // facts updated because item content changed
  contradictions: number; // conflicts detected after pull
  synced_at: string;     // ISO datetime
}

/** Result of a sync push. */
export interface PushResult {
  store_id: string;
  label: string;
  pushed: number;        // new items created in the Memory Store
  skipped: number;       // facts already present in the Memory Store
  errors: number;        // facts that failed to push (logged to stderr)
  synced_at: string;     // ISO datetime
}

/** Combined result when direction = "both". */
export interface BothResult {
  pull: SyncResult;
  push: PushResult;
}
