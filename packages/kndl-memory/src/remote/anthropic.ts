// remote/anthropic.ts — Anthropic Memory Stores API client.
//
// REST wrapper against https://api.anthropic.com/v1/memory_stores
// Spec: https://platform.claude.com/docs/en/api/go/beta/memory_stores
//
// Uses fetch() directly — no SDK dependency so API surface changes don't
// require a hard version bump. Gate all calls on ANTHROPIC_API_KEY.

import type {
  MemoryStoreClient,
  MemoryStore, DeletedMemoryStore,
  Memory, MemoryListItem, DeletedMemory,
  MemoryVersion,
  PagedResult,
  ListStoresOptions, ListMemoriesOptions, ListVersionsOptions,
} from "./types";

const BASE_URL    = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
// Beta identifier for Memory Stores (update if Anthropic changes it)
const BETA_HEADER = "managed-agents-2026-04-01";

// ── Retry on 429 / 529 ───────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, baseMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status !== 429 && status !== 529) throw e;
      if (attempt === maxRetries) break;
      await new Promise(r => setTimeout(r, baseMs * Math.pow(2, attempt) + Math.random() * 200));
    }
  }
  throw lastErr;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export class AnthropicMemoryClient implements MemoryStoreClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      "x-api-key":        this.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-beta":    BETA_HEADER,
      "content-type":      "application/json",
    };
  }

  private async req<T>(method: string, path: string, body?: unknown, qs?: Record<string, string>): Promise<T> {
    const url = new URL(BASE_URL + path);
    if (qs) Object.entries(qs).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
    return withRetry(async () => {
      const r = await fetch(url.toString(), {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const err: { status: number; message: string } = { status: r.status, message: `Anthropic API ${r.status}: ${text.slice(0, 300)}` };
        throw Object.assign(new Error(err.message), { status: r.status });
      }
      if (r.status === 204) return undefined as T;
      return r.json() as Promise<T>;
    });
  }

  // ── Store CRUD ──────────────────────────────────────────────────────────────

  async createStore(name: string, opts?: { description?: string; metadata?: Record<string, string> }): Promise<MemoryStore> {
    return this.req("POST", "/v1/memory_stores", { name, ...opts });
  }

  async listStores(opts: ListStoresOptions = {}): Promise<PagedResult<MemoryStore>> {
    const qs: Record<string, string> = {};
    if (opts.include_archived) qs["include_archived"] = "true";
    if (opts.limit)            qs["limit"] = String(opts.limit);
    if (opts.page)             qs["page"]  = opts.page;
    const raw = await this.req<{ data: MemoryStore[]; next_page?: string; has_more?: boolean }>("GET", "/v1/memory_stores", undefined, qs);
    return { data: raw.data ?? [], next_page: raw.next_page, has_more: raw.has_more ?? !!raw.next_page };
  }

  async getStore(storeId: string): Promise<MemoryStore | null> {
    try { return await this.req("GET", `/v1/memory_stores/${storeId}`); }
    catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
  }

  async updateStore(storeId: string, opts: { name?: string; description?: string; metadata?: Record<string, string> }): Promise<MemoryStore> {
    return this.req("POST", `/v1/memory_stores/${storeId}`, opts);
  }

  async deleteStore(storeId: string): Promise<DeletedMemoryStore> {
    return this.req("DELETE", `/v1/memory_stores/${storeId}`);
  }

  async archiveStore(storeId: string): Promise<MemoryStore> {
    return this.req("POST", `/v1/memory_stores/${storeId}/archive`);
  }

  // ── Memory CRUD ─────────────────────────────────────────────────────────────

  async createMemory(storeId: string, path: string, content: string): Promise<Memory> {
    return this.req("POST", `/v1/memory_stores/${storeId}/memories`, { path, content }, { view: "full" });
  }

  async listMemories(storeId: string, opts: ListMemoriesOptions = {}): Promise<PagedResult<MemoryListItem>> {
    const qs: Record<string, string> = { view: opts.view ?? "basic" };
    if (opts.path_prefix) qs["path_prefix"] = opts.path_prefix;
    if (opts.limit)       qs["limit"]       = String(opts.limit);
    if (opts.page)        qs["page"]        = opts.page;
    if (opts.order)       qs["order"]       = opts.order;
    const raw = await this.req<{ data: MemoryListItem[]; next_page?: string; has_more?: boolean }>("GET", `/v1/memory_stores/${storeId}/memories`, undefined, qs);
    return { data: raw.data ?? [], next_page: raw.next_page, has_more: raw.has_more ?? !!raw.next_page };
  }

  async getMemory(storeId: string, memoryId: string, view: "basic" | "full" = "full"): Promise<Memory | null> {
    try { return await this.req("GET", `/v1/memory_stores/${storeId}/memories/${memoryId}`, undefined, { view }); }
    catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
  }

  async updateMemory(storeId: string, memoryId: string, opts: { content?: string; path?: string; precondition?: { content_sha256: string } }): Promise<Memory> {
    const body: Record<string, unknown> = {};
    if (opts.content !== undefined) body["content"] = opts.content;
    if (opts.path    !== undefined) body["path"]    = opts.path;
    if (opts.precondition)          body["precondition"] = { type: "content_sha256", content_sha256: opts.precondition.content_sha256 };
    return this.req("POST", `/v1/memory_stores/${storeId}/memories/${memoryId}`, body, { view: "full" });
  }

  async deleteMemory(storeId: string, memoryId: string, opts: { expected_content_sha256?: string } = {}): Promise<DeletedMemory> {
    const qs: Record<string, string> = {};
    if (opts.expected_content_sha256) qs["expected_content_sha256"] = opts.expected_content_sha256;
    return this.req("DELETE", `/v1/memory_stores/${storeId}/memories/${memoryId}`, undefined, qs);
  }

  // ── Memory Versions ─────────────────────────────────────────────────────────

  async listVersions(storeId: string, opts: ListVersionsOptions = {}): Promise<PagedResult<MemoryVersion>> {
    const qs: Record<string, string> = { view: "full" };
    if (opts.memory_id) qs["memory_id"] = opts.memory_id;
    if (opts.operation) qs["operation"] = opts.operation;
    if (opts.limit)     qs["limit"]     = String(opts.limit);
    if (opts.page)      qs["page"]      = opts.page;
    const raw = await this.req<{ data: MemoryVersion[]; next_page?: string; has_more?: boolean }>("GET", `/v1/memory_stores/${storeId}/memory_versions`, undefined, qs);
    return { data: raw.data ?? [], next_page: raw.next_page, has_more: raw.has_more ?? !!raw.next_page };
  }

  async getVersion(storeId: string, versionId: string): Promise<MemoryVersion | null> {
    try { return await this.req("GET", `/v1/memory_stores/${storeId}/memory_versions/${versionId}`, undefined, { view: "full" }); }
    catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
  }

  async redactVersion(storeId: string, versionId: string): Promise<MemoryVersion> {
    return this.req("POST", `/v1/memory_stores/${storeId}/memory_versions/${versionId}/redact`);
  }
}

// ── Fake client for tests / CI ────────────────────────────────────────────────

export class FakeMemoryStoreClient implements MemoryStoreClient {
  private stores = new Map<string, MemoryStore>();
  private memories = new Map<string, Map<string, Memory>>(); // storeId → memoryId → Memory
  private seq = 0;

  private nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
  private id(prefix: string) { return `${prefix}_${++this.seq}`; }

  // seed helpers for tests
  seedStore(name: string, id?: string): MemoryStore {
    const store: MemoryStore = { id: id ?? this.id("store"), type: "memory_store", name, created_at: this.nowIso(), updated_at: this.nowIso() };
    this.stores.set(store.id, store);
    return store;
  }
  seedMemory(storeId: string, path: string, content: string): Memory {
    if (!this.memories.has(storeId)) this.memories.set(storeId, new Map());
    const mem: Memory = { id: this.id("mem"), type: "memory", path, content, content_sha256: `hash_${this.seq}`, content_size_bytes: content.length, memory_store_id: storeId, memory_version_id: this.id("ver"), created_at: this.nowIso(), updated_at: this.nowIso() };
    this.memories.get(storeId)!.set(mem.id, mem);
    return mem;
  }

  // Store CRUD
  async createStore(name: string, opts?: { description?: string }): Promise<MemoryStore> {
    const store: MemoryStore = { id: this.id("store"), type: "memory_store", name, description: opts?.description, created_at: this.nowIso(), updated_at: this.nowIso() };
    this.stores.set(store.id, store);
    return store;
  }
  async listStores(): Promise<PagedResult<MemoryStore>> {
    return { data: [...this.stores.values()], has_more: false };
  }
  async getStore(id: string): Promise<MemoryStore | null> { return this.stores.get(id) ?? null; }
  async updateStore(id: string, opts: { name?: string; description?: string }): Promise<MemoryStore> {
    const s = this.stores.get(id); if (!s) throw new Error(`store not found: ${id}`);
    Object.assign(s, opts, { updated_at: this.nowIso() });
    return s;
  }
  async deleteStore(id: string): Promise<DeletedMemoryStore> {
    this.stores.delete(id); this.memories.delete(id);
    return { id, type: "memory_store_deleted" };
  }
  async archiveStore(id: string): Promise<MemoryStore> {
    const s = this.stores.get(id); if (!s) throw new Error(`store not found: ${id}`);
    s.archived_at = this.nowIso(); return s;
  }

  // Memory CRUD
  async createMemory(storeId: string, path: string, content: string): Promise<Memory> {
    if (!this.memories.has(storeId)) this.memories.set(storeId, new Map());
    const mem: Memory = { id: this.id("mem"), type: "memory", path, content, content_sha256: `hash_${this.seq}`, content_size_bytes: content.length, memory_store_id: storeId, memory_version_id: this.id("ver"), created_at: this.nowIso(), updated_at: this.nowIso() };
    this.memories.get(storeId)!.set(mem.id, mem);
    return mem;
  }
  async listMemories(storeId: string, opts: ListMemoriesOptions = {}): Promise<PagedResult<MemoryListItem>> {
    const all = [...(this.memories.get(storeId)?.values() ?? [])];
    const filtered = opts.path_prefix ? all.filter(m => m.path.startsWith(opts.path_prefix!)) : all;
    return { data: filtered as MemoryListItem[], has_more: false };
  }
  async getMemory(storeId: string, memoryId: string): Promise<Memory | null> {
    return this.memories.get(storeId)?.get(memoryId) ?? null;
  }
  async updateMemory(storeId: string, memoryId: string, opts: { content?: string; path?: string }): Promise<Memory> {
    const m = this.memories.get(storeId)?.get(memoryId); if (!m) throw new Error("not found");
    if (opts.content !== undefined) m.content = opts.content;
    if (opts.path    !== undefined) m.path    = opts.path;
    m.updated_at = this.nowIso();
    return m;
  }
  async deleteMemory(storeId: string, memoryId: string): Promise<DeletedMemory> {
    this.memories.get(storeId)?.delete(memoryId);
    return { id: memoryId, type: "memory_deleted" };
  }

  // Versions (stub)
  async listVersions(): Promise<PagedResult<MemoryVersion>> { return { data: [], has_more: false }; }
  async getVersion(): Promise<MemoryVersion | null> { return null; }
  async redactVersion(storeId: string, versionId: string): Promise<MemoryVersion> {
    throw new Error(`redact not supported in fake client: ${storeId}/${versionId}`);
  }
}
