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
