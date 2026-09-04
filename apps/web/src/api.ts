export interface ProjectOverview {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly repositoryUri: string | null;
    readonly revision: number;
  };
  readonly counts: {
    readonly concepts: number;
    readonly claims: number;
    readonly evidence: number;
    readonly contexts: number;
    readonly reflectionEvents: number;
  };
}

export interface ClaimSummary {
  readonly id: string;
  readonly statement: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string | null;
  readonly epistemicBasis: string;
  readonly confidenceLevel: string;
  readonly lifecycleStatus: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contextIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly score?: number;
}

export interface ContextDimensions {
  readonly operatingSystem: string | null;
  readonly application: string | null;
  readonly runtime: string | null;
  readonly runtimeVersion: string | null;
  readonly framework: string | null;
  readonly frameworkVersion: string | null;
  readonly platform: string | null;
  readonly environment: string | null;
}

export interface ContextHealth {
  readonly claims: number;
  readonly concepts: number;
  readonly relations: number;
  readonly active: number;
  readonly disputed: number;
  readonly tentative: number;
  readonly withoutEvidence: number;
  readonly historical: number;
  readonly recent: number;
  readonly components: number;
  readonly isolatedConcepts: number;
  readonly probableDuplicateConcepts: number;
}

export interface ContextSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensions: ContextDimensions;
  readonly health: Omit<ContextHealth, "relations" | "recent" | "components" | "isolatedConcepts" | "probableDuplicateConcepts">;
}

export interface ContextRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensions: ContextDimensions;
  readonly conceptIds: readonly string[];
}

export interface ContextCatalog {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly contexts: readonly ContextSummary[];
  readonly unscopedClaims: number;
}

interface MapNodeBase {
  readonly id: string;
  readonly priority: "P0" | "P1" | "P2" | "P3" | "P4";
  readonly flags: readonly string[];
  readonly localDegree: number;
  readonly boundary: boolean;
}

export interface ConceptMapNode extends MapNodeBase {
  readonly kind: "concept";
  readonly canonicalName: string;
  readonly description: string | null;
  readonly conceptType: string;
  readonly aliases: readonly string[];
}

export interface ClaimMapNode extends MapNodeBase, ClaimSummary {
  readonly kind: "claim";
}

export type KnowledgeMapNode = ConceptMapNode | ClaimMapNode;

export interface KnowledgeMapEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: "SUBJECT" | "OBJECT" | "SUPPORTS" | "CONTRADICTS" | "SUPERSEDES" | "REFINES" | "DERIVED_FROM";
  readonly kind: "structural" | "claim_relation";
  readonly boundary: boolean;
}

export interface ContextGraph {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly context: ContextRecord;
  readonly options: {
    readonly includeBoundary: boolean;
    readonly includeUnscoped: boolean;
    readonly includeHistory: boolean;
    readonly limit: number;
  };
  readonly nodes: readonly KnowledgeMapNode[];
  readonly edges: readonly KnowledgeMapEdge[];
  readonly health: ContextHealth;
  readonly totalPrimaryClaims: number;
  readonly includedPrimaryClaims: number;
  readonly truncated: boolean;
}

export interface ContextGraphOptions {
  readonly includeBoundary?: boolean;
  readonly includeUnscoped?: boolean;
  readonly includeHistory?: boolean;
  readonly limit?: number;
}

export interface Evidence {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly content: string | null;
  readonly sourceUri: string | null;
  readonly observedAt: string | null;
  readonly retrievedAt: string | null;
  readonly contentHash: string | null;
  readonly repo: string | null;
  readonly commit: string | null;
  readonly branch: string | null;
  readonly file: string | null;
  readonly symbol: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly command: string | null;
  readonly result: string | null;
  readonly quote: string | null;
}

export interface HistoryEvent {
  readonly id: string;
  readonly trigger: string;
  readonly createdAt: string;
  readonly metadata: Record<string, string | null>;
  readonly operations: readonly { readonly type: string; readonly entityId: string }[];
}

export interface SearchResult {
  readonly query: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly claims: readonly ClaimSummary[];
  readonly evidence: readonly Evidence[];
  readonly rankingMetadata: {
    readonly algorithm: string;
    readonly channels: readonly string[];
    readonly embeddingDigest: string;
  };
}

export interface ClaimExplanation {
  readonly claim: ClaimSummary & {
    readonly projectId: string;
    readonly supports: readonly string[];
    readonly contradicts: readonly string[];
    readonly supersedes: readonly string[];
    readonly refines: readonly string[];
    readonly derivedFrom: readonly string[];
    readonly provenance: Record<string, string | null>;
    readonly revision: number;
  };
  readonly epistemicState: {
    readonly basis: string;
    readonly confidence: string;
    readonly lifecycleStatus: string;
  };
  readonly supportingEvidence: readonly Evidence[];
  readonly supportingClaims: readonly ClaimSummary[];
  readonly contradictingClaims: readonly ClaimSummary[];
  readonly supersededClaims: readonly ClaimSummary[];
  readonly provenance: Record<string, string | null>;
  readonly reflectionHistory: readonly HistoryEvent[];
}

export interface PotentialConflict {
  readonly claimId: string;
  readonly similarity: number;
  readonly conflictReason: string;
  readonly contextOverlap: readonly string[];
  readonly temporalOverlap: boolean;
  readonly evidenceSummary: readonly string[];
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? body.error?.message : undefined;
    throw new Error(message ?? `MemoryOS HTTP ${response.status}`);
  }
  return body as T;
}

const projectPath = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}`;

export const memoryApi = {
  async projects(): Promise<readonly ProjectOverview[]> {
    return (await request<{ projects: readonly ProjectOverview[] }>("/api/v1/projects")).projects;
  },
  search(projectId: string, query: string): Promise<SearchResult> {
    return request(`${projectPath(projectId)}/search?q=${encodeURIComponent(query)}&limit=30`);
  },
  contexts(projectId: string): Promise<ContextCatalog> {
    return request(`${projectPath(projectId)}/contexts`);
  },
  contextGraph(projectId: string, contextId: string, options: ContextGraphOptions = {}): Promise<ContextGraph> {
    const query = new URLSearchParams();
    if (options.includeBoundary !== undefined) query.set("include_boundary", String(options.includeBoundary));
    if (options.includeUnscoped !== undefined) query.set("include_unscoped", String(options.includeUnscoped));
    if (options.includeHistory !== undefined) query.set("include_history", String(options.includeHistory));
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return request(`${projectPath(projectId)}/contexts/${encodeURIComponent(contextId)}/graph${suffix}`);
  },
  explanation(projectId: string, claimId: string): Promise<ClaimExplanation> {
    return request(`${projectPath(projectId)}/claims/${encodeURIComponent(claimId)}/explanation`);
  },
  async conflicts(projectId: string, claimId: string): Promise<readonly PotentialConflict[]> {
    return (await request<{ potentialConflicts: readonly PotentialConflict[] }>(
      `${projectPath(projectId)}/claims/${encodeURIComponent(claimId)}/conflicts`,
    )).potentialConflicts;
  },
  async history(projectId: string, claimId?: string): Promise<readonly HistoryEvent[]> {
    const filter = claimId === undefined ? "" : `?entity_type=Claim&entity_id=${encodeURIComponent(claimId)}`;
    return (await request<{ events: readonly HistoryEvent[] }>(`${projectPath(projectId)}/history${filter}`)).events;
  },
};
