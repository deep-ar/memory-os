import { describe, expect, it } from "vitest";
import {
  createKnowledgeMapService,
  type KnowledgeMapCatalogSource,
  type KnowledgeMapGraphSource,
  type KnowledgeMapReadStore,
} from "../src/modules/knowledge-map/index.js";

const dimensions = {
  operatingSystem: null, application: "MemoryOS", runtime: null, runtimeVersion: null,
  framework: null, frameworkVersion: null, platform: null, environment: "test",
};
const contexts = [
  { id: "context-a", name: "Context A", description: "Primary", dimensions, conceptIds: ["orphan"] },
  { id: "context-b", name: "Context B", description: "Boundary", dimensions, conceptIds: [] },
] as const;
const concepts = [
  { id: "system", canonicalName: "System", description: null, conceptType: "system", aliases: [] },
  { id: "decision", canonicalName: "Decision", description: null, conceptType: "decision", aliases: [] },
  { id: "problem", canonicalName: "Problem", description: null, conceptType: "problem", aliases: [] },
  { id: "orphan", canonicalName: "Orphan", description: null, conceptType: "topic", aliases: [] },
  { id: "duplicate", canonicalName: "system", description: null, conceptType: "system", aliases: [] },
] as const;
const base = {
  predicate: "DESCRIBES",
  epistemicBasis: "observed" as const,
  confidenceLevel: "verified" as const,
  lifecycleStatus: "active" as const,
  validFrom: null,
  validTo: null,
  lastVerifiedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const claims = [
  { ...base, id: "claim-reviewed", subjectId: "system", objectId: "decision", statement: "Reviewed", contextIds: ["context-a"], evidenceIds: ["evidence-1"] },
  { ...base, id: "claim-no-evidence", subjectId: "problem", objectId: null, statement: "Needs evidence", contextIds: ["context-a"], evidenceIds: [] },
  { ...base, id: "claim-unscoped", subjectId: "system", objectId: null, statement: "No scope", contextIds: [], evidenceIds: ["evidence-2"] },
  { ...base, id: "claim-boundary", subjectId: "duplicate", objectId: null, statement: "Other context", contextIds: ["context-b"], evidenceIds: ["evidence-3"] },
  { ...base, id: "claim-history", subjectId: "system", objectId: null, statement: "Old", contextIds: ["context-a"], evidenceIds: ["evidence-4"], lifecycleStatus: "historical" as const },
] as const;
const relations = [
  { sourceId: "claim-boundary", targetId: "claim-reviewed", type: "SUPPORTS" as const },
  { sourceId: "claim-no-evidence", targetId: "claim-reviewed", type: "CONTRADICTS" as const },
];

function source(): KnowledgeMapGraphSource {
  return {
    projectId: "project-1", projectRevision: 7, context: contexts[0],
    concepts, claims, relations,
  };
}

function store(): KnowledgeMapReadStore {
  return {
    loadCatalog: async (projectId): Promise<KnowledgeMapCatalogSource | null> => projectId === "project-1"
      ? { projectId, projectRevision: 7, contexts, claims }
      : null,
    loadContextGraph: async (input) => input.projectId === "project-1" && input.contextId === "context-a"
      ? source()
      : null,
  };
}

describe("knowledge map", () => {
  it("lists explicit contexts and reports unscoped memory separately", async () => {
    const result = await createKnowledgeMapService(store()).listContexts("project-1");

    expect(result).toMatchObject({ projectRevision: 7, unscopedClaims: 1 });
    expect(result?.contexts.map((context) => context.id)).toEqual(["context-a", "context-b"]);
    expect(result?.contexts[0]?.health).toMatchObject({ claims: 3, concepts: 4, historical: 1, withoutEvidence: 1 });
  });

  it("builds a two-node-kind graph, keeps Evidence out, and marks review risks", async () => {
    const result = await createKnowledgeMapService(store()).getContextGraph({
      projectId: "project-1", contextId: "context-a",
    });

    expect(new Set(result?.nodes.map((node) => node.kind))).toEqual(new Set(["concept", "claim"]));
    expect(result?.nodes.some((node) => node.id === "evidence-1")).toBe(false);
    expect(result?.nodes.find((node) => node.id === "claim-no-evidence")).toMatchObject({
      priority: "P0", flags: expect.arrayContaining(["without_evidence", "contradiction"]),
    });
    expect(result?.nodes.find((node) => node.id === "orphan")).toMatchObject({ priority: "P0", flags: ["orphan"] });
    expect(result?.nodes.find((node) => node.id === "claim-boundary")).toMatchObject({ boundary: true });
    expect(result?.nodes.some((node) => node.id === "claim-history")).toBe(false);
    expect(result?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "system", target: "claim-reviewed", relation: "SUBJECT" }),
      expect.objectContaining({ source: "claim-reviewed", target: "decision", relation: "OBJECT" }),
      expect.objectContaining({ source: "claim-boundary", target: "claim-reviewed", relation: "SUPPORTS" }),
    ]));
  });

  it("applies deterministic primary-Claim limits and optional layers", async () => {
    const service = createKnowledgeMapService(store());
    const result = await service.getContextGraph({
      projectId: "project-1", contextId: "context-a", includeUnscoped: true,
      includeHistory: true, includeBoundary: false, limit: 2,
    });

    const primaryClaims = result?.nodes.filter((node) => node.kind === "claim" && !node.boundary) ?? [];
    expect(primaryClaims).toHaveLength(2);
    expect(primaryClaims.map((node) => node.id)).toEqual(["claim-reviewed", "claim-no-evidence"]);
    expect(primaryClaims.every((node) => node.priority === "P0")).toBe(true);
    expect(result).toMatchObject({ totalPrimaryClaims: 4, includedPrimaryClaims: 2, truncated: true });
    await expect(service.getContextGraph({ projectId: "project-1", contextId: "context-a", limit: 1_001 }))
      .rejects.toThrow(/between 1 and 1000/);
  });

  it("returns null without crossing project or context boundaries", async () => {
    const service = createKnowledgeMapService(store());
    await expect(service.listContexts("other-project")).resolves.toBeNull();
    await expect(service.getContextGraph({ projectId: "project-1", contextId: "missing" })).resolves.toBeNull();
  });
});
