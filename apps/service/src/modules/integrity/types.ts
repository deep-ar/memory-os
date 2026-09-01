export interface IntegrityCounts {
  readonly projects: number;
  readonly concepts: number;
  readonly claims: number;
  readonly evidence: number;
  readonly contexts: number;
  readonly reflectionEvents: number;
  readonly activeClaims?: number;
  readonly disputedClaims?: number;
  readonly supersededClaims?: number;
  readonly invalidatedClaims?: number;
}

export interface RevisionMismatch {
  readonly projectId: string;
  readonly revision: number;
  readonly reflectionEvents: number;
}

export interface IntegrityFacts {
  readonly schemaVersion: number | null;
  readonly counts: IntegrityCounts;
  readonly schemaVersionViolations: number;
  readonly orphanEntities: number;
  readonly claimsWithoutSingleSubject: number;
  readonly crossProjectRelationships: number;
  readonly revisionMismatches: readonly RevisionMismatch[];
}

export interface IntegrityFactStore {
  inspectIntegrity(): Promise<IntegrityFacts>;
}

export interface IntegrityIssue {
  readonly code:
    | "SCHEMA_VERSION_MISMATCH"
    | "OBJECT_SCHEMA_VERSION_MISMATCH"
    | "ORPHAN_ENTITY"
    | "CLAIM_SUBJECT_INTEGRITY"
    | "CROSS_PROJECT_RELATIONSHIP"
    | "PROJECT_REVISION_EVENT_MISMATCH";
  readonly severity: "error";
  readonly count: number;
  readonly message: string;
  readonly projectIds: readonly string[];
}

export interface IntegrityReport {
  readonly status: "healthy" | "degraded";
  readonly checkedAt: string;
  readonly expectedSchemaVersion: 1;
  readonly actualSchemaVersion: number | null;
  readonly counts: IntegrityCounts;
  readonly issues: readonly IntegrityIssue[];
}
