// remote/types.ts — interfaces for the Anthropic Memory Stores remote layer.

/** One item in an Anthropic Memory Store. */
export interface MemoryStoreItem {
  id: string;
  store_id: string;
  content: string;
  created_at: string;  // ISO datetime
  updated_at?: string; // ISO datetime
  metadata?: Record<string, unknown>;
}

/** Paginated list response. */
export interface MemoryStoreListResult {
  items: MemoryStoreItem[];
  /** Cursor for next page; undefined when there are no more pages. */
  next_cursor?: string;
  has_more: boolean;
}

export interface ListItemsOptions {
  /** Cursor returned from a previous list call (for pagination). */
  after?: string;
  limit?: number;
}

/** Abstract interface for a Memory Store client — real or fake. */
export interface MemoryStoreClient {
  listItems(storeId: string, opts?: ListItemsOptions): Promise<MemoryStoreListResult>;
  getItem(storeId: string, itemId: string): Promise<MemoryStoreItem | null>;
  createItem(storeId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryStoreItem>;
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
