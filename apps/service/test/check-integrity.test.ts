import { describe, expect, it } from "vitest";
import { createCheckIntegrity, type IntegrityFacts } from "../src/modules/integrity/index.js";

const healthy: IntegrityFacts = {
  schemaVersion: 1,
  counts: { projects: 1, concepts: 2, claims: 1, evidence: 1, contexts: 0, reflectionEvents: 1 },
  schemaVersionViolations: 0,
  orphanEntities: 0,
  claimsWithoutSingleSubject: 0,
  crossProjectRelationships: 0,
  revisionMismatches: [],
};

describe("integrity report", () => {
  it("is healthy only when all primary invariants hold", async () => {
    const check = createCheckIntegrity({
      store: { inspectIntegrity: async () => healthy },
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
    });
    await expect(check()).resolves.toMatchObject({ status: "healthy", issues: [], counts: { claims: 1 } });
  });

  it("returns stable issue codes without repairing data", async () => {
    const check = createCheckIntegrity({
      store: { inspectIntegrity: async () => ({
        ...healthy,
        schemaVersion: null,
        orphanEntities: 2,
        revisionMismatches: [{ projectId: "project-1", revision: 2, reflectionEvents: 1 }],
      }) },
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
    });
    const report = await check();
    expect(report.status).toBe("degraded");
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "SCHEMA_VERSION_MISMATCH", "ORPHAN_ENTITY", "PROJECT_REVISION_EVENT_MISMATCH",
    ]);
  });
});
