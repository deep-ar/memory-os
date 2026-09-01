import { describe, expect, it } from "vitest";
import { createMemoryToolService, type MemoryReadStore } from "../src/modules/memory-tools/index.js";
import type { SearchMemoryResult } from "../src/modules/retrieval/index.js";

const semanticClaim = {
  id: "claim-semantic", subjectId: "other-subject", predicate: "PREVENTS", objectId: null,
  statement: "Atomic commits prevent partially saved writes ".repeat(20),
  epistemicBasis: "tested" as const, confidenceLevel: "verified" as const,
  lifecycleStatus: "active" as const, validFrom: null, validTo: null, lastVerifiedAt: null,
  createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
  contextIds: ["windows"], evidenceIds: ["test-1"], score: 0.9,
  retrievalScore: 0.9, policyMultiplier: 1,
};

const searchResult: SearchMemoryResult = {
  query: "atomic commits", projectId: "project-1",
  entryPoints: [{
    entityId: semanticClaim.id, entityType: "claim", score: 0.04,
    channelRanks: { semantic: 1 },
  }],
  claims: [semanticClaim],
  concepts: [{
    id: "other-subject", canonicalName: "Atomic commit", description: null,
    conceptType: "Mechanism", aliases: [],
  }],
  evidence: [{
    id: "test-1", type: "test", summary: "Concurrent write test passed",
    sourceUri: null, file: null, observedAt: null,
  }],
  contexts: [{
    id: "windows", name: "Windows", description: null,
    dimensions: {
      operatingSystem: "windows", application: null, runtime: null, runtimeVersion: null,
      framework: null, frameworkVersion: null, platform: null, environment: null,
    },
  }],
  edges: [{ from: semanticClaim.id, to: "test-1", type: "SUPPORTED_BY" }],
  rankingMetadata: {
    algorithm: "RRF", channels: ["semantic", "full_text", "graph"],
    embeddingDigest: "digest", graphDepth: 0,
  },
};

const reads: MemoryReadStore = {
  getProjectRevision: async () => 7,
  getClaim: async () => null,
  explainClaim: async () => null,
  findConflicts: async () => [{
    claimId: "claim-structural", similarity: 0.25, conflictReason: "same_subject_predicate",
    contextOverlap: [], temporalOverlap: true, evidenceSummary: [],
  }],
  history: async () => [],
};

const service = createMemoryToolService({
  searchMemory: async () => searchResult,
  applyMemoryDelta: async () => ({
    ok: true, projectRevision: 8, reflectionEventId: "event-1",
    created: { concepts: [], claims: [], evidence: [], contexts: [] },
  }),
  reads,
});

describe("MemoryToolService", () => {
  it("merges structural and semantic conflict candidates without resolving them", async () => {
    const result = await service.findConflicts({
      projectId: "project-1", subjectId: "subject-1", predicate: "PREVENTS",
      objectId: null, statement: "Prevent partially committed writes",
      contextIds: ["windows"], validFrom: null, validTo: null,
    });

    expect(result.potentialConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: "claim-structural", conflictReason: "same_subject_predicate" }),
      expect.objectContaining({
        claimId: "claim-semantic", conflictReason: "semantic_similarity",
        contextOverlap: ["windows"], evidenceSummary: ["Concurrent write test passed"],
      }),
    ]));
  });

  it("returns the current project revision and enforces the context token budget", async () => {
    const result = await service.getContext({
      projectId: "project-1", taskDescription: "Investigate atomic commits", tokenBudget: 256,
    });

    expect(result.projectRevision).toBe(7);
    expect(result.estimatedTokens).toBeLessThanOrEqual(256);
    expect(result.truncated).toBe(true);
  });
});
