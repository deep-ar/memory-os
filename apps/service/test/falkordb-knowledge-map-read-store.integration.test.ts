import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDbKnowledgeMapReadStore } from "../src/adapters/memory/falkordb-knowledge-map-read-store.js";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";
import { createApplyMemoryDelta } from "../src/modules/reflection/index.js";
import type { EmbeddingProvider } from "../src/modules/retrieval/index.js";

const url = process.env.FALKORDB_INTEGRATION_URL;
const integration = url === undefined ? describe.skip : describe;
const graphName = `memoryos_knowledge_map_${process.pid}_${Date.now()}`;
const projectId = "map-project";
const dimensions = {
  operatingSystem: null, application: "MemoryOS", runtime: null, runtimeVersion: null,
  framework: null, frameworkVersion: null, platform: null, environment: "integration",
};
const embeddings: EmbeddingProvider = {
  describeModel: async () => ({ provider: "ollama", model: "test", digest: "map-digest", dimension: 3 }),
  embed: async (texts) => ({
    identity: { provider: "ollama", model: "test", digest: "map-digest", dimension: 3 },
    vectors: texts.map((_, index) => [1, index / 100, 0]),
  }),
};

integration("FalkorDB knowledge map read adapter", () => {
  let writes: FalkorDbMemoryStore;
  let reads: FalkorDbKnowledgeMapReadStore;
  let inspector: FalkorDB;

  beforeAll(async () => {
    writes = await FalkorDbMemoryStore.connect({ url: url!, graphName });
    reads = await FalkorDbKnowledgeMapReadStore.connect({ url: url!, graphName });
    inspector = await FalkorDB.connect({ url: url! });
    await writes.bootstrap({ embeddingDimension: 3 });
    await writes.registerProject({
      id: projectId, name: "Map project", description: null,
      repositoryUri: null, revision: 0, schemaVersion: 1,
    });
    const apply = createApplyMemoryDelta({
      store: writes, embeddings,
      clock: { now: () => "2026-09-05T00:00:00.000Z" },
      ids: { nextId: () => "map-event" },
    });
    const result = await apply({
      projectId,
      delta: {
        expectedRevision: 0,
        reflection: {
          agentId: "test", agentType: "integration", sessionId: null, taskId: null,
          workspaceId: null, worktreeId: null, branch: null, commit: null, trigger: "manual",
        },
        concepts: [
          { id: "system", projectId, canonicalName: "System", description: null, conceptType: "system", aliases: [] },
          { id: "decision", projectId, canonicalName: "Decision", description: null, conceptType: "decision", aliases: [] },
          { id: "boundary", projectId, canonicalName: "Boundary", description: null, conceptType: "constraint", aliases: [] },
        ],
        contexts: [
          { id: "context-a", projectId, name: "Context A", description: null, dimensions, conceptIds: ["system"] },
          { id: "context-b", projectId, name: "Context B", description: null, dimensions, conceptIds: [] },
        ],
        evidence: [{
          id: "evidence", projectId, type: "test", summary: "Verified", content: null,
          sourceUri: null, repo: null, commit: null, branch: null, file: null, symbol: null,
          lineStart: null, lineEnd: null, command: null, result: null, quote: null,
          observedAt: "2026-09-05T00:00:00.000Z", retrievedAt: null, contentHash: null,
        }],
        claims: [
          {
            id: "claim-a", projectId, subjectId: "system", predicate: "USES", objectId: "decision",
            statement: "System uses decision", epistemicBasis: "tested", confidenceLevel: "verified",
            lifecycleStatus: "active", validFrom: null, validTo: null,
            lastVerifiedAt: "2026-09-05T00:00:00.000Z", contextIds: ["context-a"], evidenceIds: ["evidence"],
            supports: [], contradicts: [], supersedes: [], refines: [], derivedFrom: [],
          },
          {
            id: "claim-b", projectId, subjectId: "boundary", predicate: "SUPPORTS", objectId: "system",
            statement: "Boundary supports system", epistemicBasis: "observed", confidenceLevel: "supported",
            lifecycleStatus: "active", validFrom: null, validTo: null, lastVerifiedAt: null,
            contextIds: ["context-b"], evidenceIds: ["evidence"], supports: ["claim-a"],
            contradicts: [], supersedes: [], refines: [], derivedFrom: [],
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  afterAll(async () => {
    await reads.close();
    await writes.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.close();
  });

  it("loads catalog membership, context concepts, and one-hop Claim relations", async () => {
    const catalog = await reads.loadCatalog(projectId);
    const graph = await reads.loadContextGraph({
      projectId, contextId: "context-a", includeUnscoped: false, includeBoundary: true,
    });

    expect(catalog).toMatchObject({ projectRevision: 1, contexts: [{ id: "context-a" }, { id: "context-b" }] });
    expect(catalog?.contexts[0]?.conceptIds).toEqual(["system"]);
    expect(graph?.claims.map((claim) => claim.id)).toEqual(["claim-a", "claim-b"]);
    expect(graph?.concepts.map((concept) => concept.id)).toEqual(["boundary", "decision", "system"]);
    expect(graph?.relations).toEqual([{ sourceId: "claim-b", targetId: "claim-a", type: "SUPPORTS" }]);
  });

  it("does not cross project or unknown-context boundaries", async () => {
    await expect(reads.loadCatalog("missing-project")).resolves.toBeNull();
    await expect(reads.loadContextGraph({
      projectId, contextId: "missing", includeUnscoped: false, includeBoundary: true,
    })).resolves.toBeNull();
  });
});
