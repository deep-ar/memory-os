import type { ApplyMemoryDeltaCommand, EvidenceDraft } from "../knowledge/index.js";
import type { Provenance } from "../knowledge/index.js";
import type {
  ApplyMemoryDeltaResult,
} from "../reflection/index.js";
import type {
  RetrievedClaim,
  RetrievedContext,
  SearchContext,
  SearchInclude,
  SearchMemoryResult,
  SearchTime,
} from "../retrieval/index.js";

export interface SearchToolInput {
  readonly projectId: string;
  readonly query: string;
  readonly context?: SearchContext | null;
  readonly include?: Partial<SearchInclude>;
  readonly time?: Partial<SearchTime>;
  readonly maxResults?: number;
  readonly graphDepth?: number;
}

export interface GetContextInput {
  readonly projectId: string;
  readonly taskDescription: string;
  readonly currentContext?: SearchContext | null;
  readonly tokenBudget?: number | null;
}

export interface AgentContextResult {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly taskDescription: string;
  readonly claims: SearchMemoryResult["claims"];
  readonly concepts: SearchMemoryResult["concepts"];
  readonly evidence: SearchMemoryResult["evidence"];
  readonly contexts: SearchMemoryResult["contexts"];
  readonly edges: SearchMemoryResult["edges"];
  readonly estimatedTokens: number;
  readonly tokenBudget: number;
  readonly truncated: boolean;
}

export interface SearchToolResult extends SearchMemoryResult {
  readonly projectRevision: number;
}

export interface ConceptMatch {
  readonly id: string;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly conceptType: string;
  readonly similarity: number;
}

export interface FullClaim extends RetrievedClaim {
  readonly projectId: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly supersedes: readonly string[];
  readonly refines: readonly string[];
  readonly derivedFrom: readonly string[];
  readonly provenance: Provenance;
  readonly schemaVersion: 1;
  readonly revision: number;
}

export interface FullEvidence extends EvidenceDraft {
  readonly createdAt: string;
  readonly schemaVersion: 1;
}

export interface ClaimExplanation {
  readonly claim: FullClaim;
  readonly epistemicState: {
    readonly basis: RetrievedClaim["epistemicBasis"];
    readonly confidence: RetrievedClaim["confidenceLevel"];
    readonly lifecycleStatus: RetrievedClaim["lifecycleStatus"];
  };
  readonly contexts: readonly RetrievedContext[];
  readonly supportingEvidence: readonly FullEvidence[];
  readonly supportingClaims: readonly RetrievedClaim[];
  readonly contradictingClaims: readonly RetrievedClaim[];
  readonly supersededClaims: readonly RetrievedClaim[];
  readonly provenance: Provenance;
  readonly reflectionHistory: readonly ReflectionHistoryEvent[];
}

export interface ConflictCandidateInput {
  readonly projectId: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string | null;
  readonly statement: string;
  readonly contextIds: readonly string[];
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

export interface PotentialConflict {
  readonly claimId: string;
  readonly similarity: number;
  readonly conflictReason:
    | "explicit_contradiction"
    | "same_subject_predicate"
    | "same_subject"
    | "semantic_similarity";
  readonly contextOverlap: readonly string[];
  readonly temporalOverlap: boolean;
  readonly evidenceSummary: readonly string[];
}

export interface HistoryInput {
  readonly projectId: string;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly limit?: number;
}

export interface ReflectionHistoryEvent {
  readonly id: string;
  readonly projectId: string;
  readonly trigger: string;
  readonly createdAt: string;
  readonly metadata: Record<string, string | null>;
  readonly operations: readonly { readonly type: string; readonly entityId: string }[];
}

export interface MemoryReadStore {
  getProjectRevision(projectId: string): Promise<number | null>;
  getClaim(projectId: string, claimId: string): Promise<FullClaim | null>;
  explainClaim(projectId: string, claimId: string): Promise<ClaimExplanation | null>;
  findConflicts(input: ConflictCandidateInput): Promise<readonly PotentialConflict[]>;
  history(input: HistoryInput): Promise<readonly ReflectionHistoryEvent[]>;
}

export interface MemoryToolService {
  search(input: SearchToolInput): Promise<SearchToolResult>;
  getContext(input: GetContextInput): Promise<AgentContextResult>;
  findConcepts(input: {
    readonly projectId: string;
    readonly query: string;
    readonly limit?: number;
  }): Promise<{ readonly concepts: readonly ConceptMatch[] }>;
  getClaim(input: { readonly projectId: string; readonly claimId: string }): Promise<FullClaim | null>;
  explainClaim(input: { readonly projectId: string; readonly claimId: string }): Promise<ClaimExplanation | null>;
  findConflicts(input: ConflictCandidateInput): Promise<{ readonly potentialConflicts: readonly PotentialConflict[] }>;
  applyDelta(input: ApplyMemoryDeltaCommand): Promise<ApplyMemoryDeltaResult>;
  history(input: HistoryInput): Promise<{ readonly events: readonly ReflectionHistoryEvent[] }>;
}
