export type ProjectId = string;
export type EntityId = string;

export type EpistemicBasis =
  | "hypothesis"
  | "inferred"
  | "observed"
  | "tested"
  | "source_reported"
  | "user_asserted"
  | "code_derived"
  | "decision";

export type ConfidenceLevel =
  | "tentative"
  | "supported"
  | "verified"
  | "established";

export type LifecycleStatus =
  | "active"
  | "disputed"
  | "superseded"
  | "invalidated"
  | "historical";

export type EvidenceType =
  | "test"
  | "benchmark"
  | "experiment"
  | "code"
  | "web_source"
  | "documentation"
  | "user_statement"
  | "agent_observation"
  | "log"
  | "tool_result";

export type ReflectionTrigger =
  | "task_complete"
  | "milestone"
  | "context_compaction"
  | "handoff"
  | "major_failure"
  | "major_discovery"
  | "user_correction"
  | "significant_test"
  | "session_end"
  | "manual";

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly description: string | null;
  readonly repositoryUri: string | null;
  readonly revision: number;
  readonly schemaVersion: 1;
}

export interface ConceptDraft {
  readonly id: EntityId;
  readonly projectId: ProjectId;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly conceptType: string;
  readonly aliases: readonly string[];
}

export interface EvidenceDraft {
  readonly id: EntityId;
  readonly projectId: ProjectId;
  readonly type: EvidenceType;
  readonly summary: string;
  readonly content: string | null;
  readonly sourceUri: string | null;
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
  readonly observedAt: string | null;
  readonly retrievedAt: string | null;
  readonly contentHash: string | null;
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

export interface ContextDraft {
  readonly id: EntityId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description: string | null;
  readonly dimensions: ContextDimensions;
  readonly conceptIds: readonly EntityId[];
}

export interface ClaimDraft {
  readonly id: EntityId;
  readonly projectId: ProjectId;
  readonly subjectId: EntityId;
  readonly predicate: string;
  readonly objectId: EntityId | null;
  readonly statement: string;
  readonly epistemicBasis: EpistemicBasis;
  readonly confidenceLevel: ConfidenceLevel;
  readonly lifecycleStatus: LifecycleStatus;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly lastVerifiedAt: string | null;
  readonly contextIds: readonly EntityId[];
  readonly evidenceIds: readonly EntityId[];
  readonly supports: readonly EntityId[];
  readonly contradicts: readonly EntityId[];
  readonly supersedes: readonly EntityId[];
  readonly refines: readonly EntityId[];
  readonly derivedFrom: readonly EntityId[];
}

export interface ReflectionMetadata {
  readonly agentId: string | null;
  readonly agentType: string | null;
  readonly sessionId: string | null;
  readonly taskId: string | null;
  readonly workspaceId: string | null;
  readonly worktreeId: string | null;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly trigger: ReflectionTrigger;
}

export interface CreateMemoryDelta {
  readonly expectedRevision: number;
  readonly reflection: ReflectionMetadata;
  readonly concepts: readonly ConceptDraft[];
  readonly claims: readonly ClaimDraft[];
  readonly evidence: readonly EvidenceDraft[];
  readonly contexts: readonly ContextDraft[];
}

export interface ApplyMemoryDeltaCommand {
  readonly projectId: ProjectId;
  readonly delta: CreateMemoryDelta;
}

export interface Provenance {
  readonly reflectionEventId: EntityId;
  readonly agentId: string | null;
  readonly agentType: string | null;
  readonly sessionId: string | null;
  readonly taskId: string | null;
  readonly workspaceId: string | null;
  readonly worktreeId: string | null;
  readonly branch: string | null;
  readonly commit: string | null;
}

export type StoredConcept = ConceptDraft & {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: 1;
};

export type StoredEvidence = EvidenceDraft & {
  readonly createdAt: string;
  readonly schemaVersion: 1;
};

export type StoredContext = ContextDraft & {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: 1;
};

export type StoredClaim = ClaimDraft & {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: Provenance;
  readonly schemaVersion: 1;
  readonly revision: 1;
};

export type ReflectionOperationType =
  | "CREATE_CONCEPT"
  | "CREATE_CLAIM"
  | "CREATE_EVIDENCE"
  | "CREATE_CONTEXT";

export interface ReflectionOperation {
  readonly type: ReflectionOperationType;
  readonly entityId: EntityId;
}

export interface ReflectionEvent {
  readonly id: EntityId;
  readonly projectId: ProjectId;
  readonly metadata: ReflectionMetadata;
  readonly createdAt: string;
  readonly operations: readonly ReflectionOperation[];
  readonly schemaVersion: 1;
}

export interface ProjectSnapshot {
  readonly project: Project;
  readonly conceptIds: ReadonlySet<EntityId>;
  readonly claimIds: ReadonlySet<EntityId>;
  readonly evidenceIds: ReadonlySet<EntityId>;
  readonly contextIds: ReadonlySet<EntityId>;
}

export interface PreparedMemoryDelta {
  readonly projectId: ProjectId;
  readonly expectedRevision: number;
  readonly concepts: readonly StoredConcept[];
  readonly claims: readonly StoredClaim[];
  readonly evidence: readonly StoredEvidence[];
  readonly contexts: readonly StoredContext[];
  readonly reflectionEvent: ReflectionEvent;
}

