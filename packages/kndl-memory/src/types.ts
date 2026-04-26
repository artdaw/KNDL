// types.ts — shared interfaces for the KNDL fact store.

export interface Fact {
  "@context"?: string;
  "@id": string;
  "@type": string;
  statement: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  confidence: number;
  decay?: string;
  source: string;
  validFrom: string;
  validUntil?: string;
  observedAt?: string;
  recordedAt: string;
  supersedes?: string;
  derivedFrom?: string[];
  inference?: string;
  negated?: boolean;
  classification?: string;
  consent?: string;
  retention?: string;
  tenant?: string;
  signature?: unknown;
  weight?: number;
  tags?: string[];
}

export interface FactInput {
  statement: string;
  confidence: number;
  source: string;
  subject?: string;
  predicate?: string;
  object?: unknown;
  decay?: string;
  validFrom?: string;
  validUntil?: string;
  observedAt?: string;
  classification?: string;
  consent?: string;
  tenant?: string;
  derivedFrom?: string[];
  negated?: boolean;
  tags?: string[];
}

export interface QueryOptions {
  subject?: string;
  predicate?: string;
  asOf?: string;
  minConfidence?: number;
  tenant?: string;
  allowPhi?: boolean;
}

export interface QueryResultFact extends Fact {
  effective_confidence: number;
}

export interface QueryResult {
  as_of: string;
  count: number;
  facts: QueryResultFact[];
}

export interface ContradictionEntry {
  subject: string | undefined;
  predicate: string | undefined;
  preferred: { id: string; object: unknown; negated: boolean; effective_confidence: number };
  conflicts_with: { id: string; object: unknown; negated: boolean; effective_confidence: number }[];
}

export interface ProvenanceNode {
  id: string;
  statement?: string;
  source?: string;
  confidence?: number;
  recordedAt?: string;
  derivedFrom?: string[];
  supersedes?: string;
  missing?: boolean;
}

export interface AssertResult {
  id: string;
  fact: Fact;
}

export interface SupersedeResult extends AssertResult {
  supersedes: string;
}

export interface ContradictionsResult {
  count: number;
  conflicts: ContradictionEntry[];
}

export interface ProvenanceResult {
  root: string;
  depth: number;
  chain: ProvenanceNode[];
}

// FactStore — the async interface every storage backend implements.
export interface FactStore {
  assertFact(input: FactInput, supersedesId?: string): Promise<AssertResult>;
  supersedeFact(oldId: string, input: FactInput): Promise<SupersedeResult>;
  query(opts?: QueryOptions): Promise<QueryResult>;
  contradictions(opts?: { subject?: string; predicate?: string }): Promise<ContradictionsResult>;
  provenanceChain(rootId: string, maxDepth?: number): Promise<ProvenanceResult>;
  list(subject?: string): Promise<string[]>;
  show(id: string): Promise<Fact | null>;
  // close() called on shutdown; optional so FS store (stateless) need not implement.
  close?(): Promise<void>;
}
