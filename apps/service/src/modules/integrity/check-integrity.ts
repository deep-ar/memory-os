import type { IntegrityFactStore, IntegrityIssue, IntegrityReport } from "./types.js";

export function createCheckIntegrity(dependencies: {
  readonly store: IntegrityFactStore;
  readonly clock: { now(): string };
}): () => Promise<IntegrityReport> {
  return async () => {
    const facts = await dependencies.store.inspectIntegrity();
    const issues: IntegrityIssue[] = [];
    if (facts.schemaVersion !== 1) issues.push({
      code: "SCHEMA_VERSION_MISMATCH", severity: "error", count: 1,
      message: `Expected primary schema version 1, received ${facts.schemaVersion ?? "missing"}.`,
      projectIds: [],
    });
    if (facts.schemaVersionViolations > 0) issues.push({
      code: "OBJECT_SCHEMA_VERSION_MISMATCH", severity: "error",
      count: facts.schemaVersionViolations,
      message: "Primary objects are missing schemaVersion=1.", projectIds: [],
    });
    if (facts.orphanEntities > 0) issues.push({
      code: "ORPHAN_ENTITY", severity: "error", count: facts.orphanEntities,
      message: "Primary objects reference a project id that does not exist.", projectIds: [],
    });
    if (facts.claimsWithoutSingleSubject > 0) issues.push({
      code: "CLAIM_SUBJECT_INTEGRITY", severity: "error", count: facts.claimsWithoutSingleSubject,
      message: "Claims must have exactly one in-project SUBJECT Concept.", projectIds: [],
    });
    if (facts.crossProjectRelationships > 0) issues.push({
      code: "CROSS_PROJECT_RELATIONSHIP", severity: "error", count: facts.crossProjectRelationships,
      message: "Relationships connect primary objects from different logical projects.", projectIds: [],
    });
    if (facts.revisionMismatches.length > 0) issues.push({
      code: "PROJECT_REVISION_EVENT_MISMATCH", severity: "error", count: facts.revisionMismatches.length,
      message: "Project revisions do not equal their immutable ReflectionEvent counts.",
      projectIds: facts.revisionMismatches.map((item) => item.projectId),
    });
    return {
      status: issues.length === 0 ? "healthy" : "degraded",
      checkedAt: dependencies.clock.now(),
      expectedSchemaVersion: 1,
      actualSchemaVersion: facts.schemaVersion,
      counts: facts.counts,
      issues,
    };
  };
}
