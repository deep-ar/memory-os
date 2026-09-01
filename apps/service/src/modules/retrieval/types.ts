import type {
  ConfidenceLevel,
  ContextDimensions,
  EpistemicBasis,
  EvidenceType,
  LifecycleStatus,
} from "../knowledge/index.js";
import type { FusedReference, RankedReference } from "./ranking.js";

export interface SearchInclude {
  readonly active: boolean;
  readonly disputed: boolean;
  readonly historical: boolean;
  readonly superseded: boolean;
  readonly invalidated: boolean;
}

export interface SearchTime {
  readonly at: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

export type SearchContext = Partial<ContextDimensions>;

export interface SearchMemoryQuery {
  readonly projectId: string;
  readonly query: string;
  readonly context?: SearchContext | null;
  readonly include?: Partial<SearchInclude>;
  readonly time?: Partial<SearchTime>;
  readonly maxResults?: number;
  readonly graphDepth?: number;
}

export interface RetrievalFilter {
  readonly include: SearchInclude;
  readonly time: SearchTime;
}

export interface RetrievedConcept {
  readonly id: string;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly conceptType: string;
  readonly aliases: readonly string[];
}

export interface RetrievedEvidence {
  readonly id: string;
  readonly type: EvidenceType;
  readonly summary: string;
  readonly sourceUri: string | null;
  readonly file: string | null;
  readonly observedAt: string | null;
}

export interface RetrievedContext {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensions: ContextDimensions;
}

export interface RetrievedClaim {
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

export interface RetrievedEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

export interface ConnectedSubgraph {
  readonly concepts: readonly RetrievedConcept[];
  readonly claims: readonly RetrievedClaim[];
  readonly evidence: readonly RetrievedEvidence[];
  readonly contexts: readonly RetrievedContext[];
  readonly edges: readonly RetrievedEdge[];
  readonly graphClaimRanking: readonly RankedReference[];
}

export interface RankedClaim extends RetrievedClaim {
  readonly score: number;
  readonly retrievalScore: number;
  readonly policyMultiplier: number;
}

export interface SearchMemoryResult {
  readonly query: string;
  readonly projectId: string;
  readonly entryPoints: readonly FusedReference[];
  readonly claims: readonly RankedClaim[];
  readonly concepts: readonly RetrievedConcept[];
  readonly evidence: readonly RetrievedEvidence[];
  readonly contexts: readonly RetrievedContext[];
  readonly edges: readonly RetrievedEdge[];
  readonly rankingMetadata: {
    readonly algorithm: "RRF";
    readonly channels: readonly ["semantic", "full_text", "graph"];
    readonly embeddingDigest: string;
    readonly graphDepth: number;
  };
}

