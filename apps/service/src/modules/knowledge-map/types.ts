import type {
  ConfidenceLevel,
  ContextDimensions,
  EpistemicBasis,
  LifecycleStatus,
} from "../knowledge/index.js";

export type KnowledgeMapPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export type ClaimRelationType =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "SUPERSEDES"
  | "REFINES"
  | "DERIVED_FROM";

export interface KnowledgeMapContextRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensions: ContextDimensions;
  readonly conceptIds: readonly string[];
}

export interface KnowledgeMapConceptRecord {
  readonly id: string;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly conceptType: string;
  readonly aliases: readonly string[];
}

export interface KnowledgeMapClaimRecord {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string | null;
  readonly statement: string;
  readonly epistemicBasis: EpistemicBasis;
  readonly confidenceLevel: ConfidenceLevel;
  readonly lifecycleStatus: LifecycleStatus;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly lastVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contextIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface KnowledgeMapClaimRelation {
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: ClaimRelationType;
}

export interface KnowledgeMapCatalogSource {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly contexts: readonly KnowledgeMapContextRecord[];
  readonly claims: readonly KnowledgeMapClaimRecord[];
}

export interface KnowledgeMapGraphSource {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly context: KnowledgeMapContextRecord;
  readonly concepts: readonly KnowledgeMapConceptRecord[];
  readonly claims: readonly KnowledgeMapClaimRecord[];
  readonly relations: readonly KnowledgeMapClaimRelation[];
}

export interface KnowledgeMapReadStore {
  loadCatalog(projectId: string): Promise<KnowledgeMapCatalogSource | null>;
  loadContextGraph(input: {
    readonly projectId: string;
    readonly contextId: string;
    readonly includeUnscoped: boolean;
    readonly includeBoundary: boolean;
  }): Promise<KnowledgeMapGraphSource | null>;
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

export interface ContextCatalogResult {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly contexts: readonly ContextSummary[];
  readonly unscopedClaims: number;
}

export interface ConceptMapNode {
  readonly kind: "concept";
  readonly id: string;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly conceptType: string;
  readonly aliases: readonly string[];
  readonly priority: KnowledgeMapPriority;
  readonly flags: readonly string[];
  readonly localDegree: number;
  readonly boundary: boolean;
}

export interface ClaimMapNode extends KnowledgeMapClaimRecord {
  readonly kind: "claim";
  readonly priority: KnowledgeMapPriority;
  readonly flags: readonly string[];
  readonly localDegree: number;
  readonly boundary: boolean;
}

export type KnowledgeMapNode = ConceptMapNode | ClaimMapNode;

export interface KnowledgeMapEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: "SUBJECT" | "OBJECT" | ClaimRelationType;
  readonly kind: "structural" | "claim_relation";
  readonly boundary: boolean;
}

export interface ContextGraphResult {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly context: KnowledgeMapContextRecord;
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

export interface ContextGraphInput {
  readonly projectId: string;
  readonly contextId: string;
  readonly includeBoundary?: boolean;
  readonly includeUnscoped?: boolean;
  readonly includeHistory?: boolean;
  readonly limit?: number;
}

export interface KnowledgeMapService {
  listContexts(projectId: string): Promise<ContextCatalogResult | null>;
  getContextGraph(input: ContextGraphInput): Promise<ContextGraphResult | null>;
}
