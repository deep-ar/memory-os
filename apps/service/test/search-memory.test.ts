import { describe, expect, it, vi } from "vitest";
import {
  createSearchMemory,
  type EmbeddingProvider,
  type ConnectedSubgraph,
  type RankedReference,
  type RetrievalStore,
} from "../src/modules/retrieval/index.js";

const embeddings: EmbeddingProvider = {
  describeModel: async () => ({ provider: "ollama", model: "bge-m3", digest: "d1", dimension: 3 }),
  embed: async () => ({
    identity: { provider: "ollama", model: "bge-m3", digest: "d1", dimension: 3 },
    vectors: [[0.1, 0.2, 0.3]],
  }),
};

describe("search memory", () => {
  it("fuses entry channels and returns a connected, context-ranked subgraph", async () => {
    const semantic: readonly RankedReference[] = [
      { entityId: "concept-atomic", entityType: "concept" },
      { entityId: "claim-old", entityType: "claim" },
    ];
    const fullText: readonly RankedReference[] = [
      { entityId: "claim-current", entityType: "claim" },
      { entityId: "concept-atomic", entityType: "concept" },
    ];
    const subgraph: ConnectedSubgraph = {
      concepts: [{
        id: "concept-atomic",
        canonicalName: "Atomic write",
        description: null,
        conceptType: "Mechanism",
        aliases: [],
      }],
      claims: [
        {
          id: "claim-current",
          subjectId: "concept-atomic",
          predicate: "REQUIRES",
          objectId: null,
          statement: "Atomic writes require a transaction",
          epistemicBasis: "tested",
          confidenceLevel: "verified",
          lifecycleStatus: "active",
          validFrom: null,
          validTo: null,
          lastVerifiedAt: null,
          createdAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-30T00:00:00.000Z",
          contextIds: ["windows"],
          evidenceIds: [],
        },
        {
          id: "claim-old",
          subjectId: "concept-atomic",
          predicate: "REQUIRES",
          objectId: null,
          statement: "Old transaction advice",
          epistemicBasis: "observed",
          confidenceLevel: "tentative",
          lifecycleStatus: "historical",
          validFrom: null,
          validTo: null,
          lastVerifiedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          contextIds: [],
          evidenceIds: [],
        },
      ],
      evidence: [],
      contexts: [{
        id: "windows",
        name: "Windows",
        description: null,
        dimensions: {
          operatingSystem: "windows",
          application: null,
          runtime: null,
          runtimeVersion: null,
          framework: null,
          frameworkVersion: null,
          platform: null,
          environment: null,
        },
      }],
      edges: [{ from: "claim-current", to: "concept-atomic", type: "SUBJECT" }],
      graphClaimRanking: [
        { entityId: "claim-current", entityType: "claim" },
        { entityId: "claim-old", entityType: "claim" },
      ],
    };
    const store: RetrievalStore = {
      searchSemantic: vi.fn(async () => semantic),
      searchFullText: vi.fn(async () => fullText),
      loadConnectedSubgraph: vi.fn(async () => subgraph),
    };
    const search = createSearchMemory({ embeddings, store });

    const result = await search({
      projectId: "memoryos",
      query: "атомарная транзакция",
      context: { operatingSystem: "windows" },
      include: { historical: true },
      maxResults: 10,
      graphDepth: 1,
    });

    expect(result.entryPoints[0]?.entityId).toBe("concept-atomic");
    expect(result.claims.map((claim) => claim.id)).toEqual(["claim-current", "claim-old"]);
    expect(result.edges).toHaveLength(1);
    expect(result.rankingMetadata).toMatchObject({ algorithm: "RRF", embeddingDigest: "d1" });
  });

  it("rejects invalid time ranges before accessing storage", async () => {
    const store = {
      searchSemantic: vi.fn(),
      searchFullText: vi.fn(),
      loadConnectedSubgraph: vi.fn(),
    } as unknown as RetrievalStore;
    const search = createSearchMemory({ embeddings, store });

    await expect(search({
      projectId: "memoryos",
      query: "query",
      time: { from: "2026-09-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
    })).rejects.toThrow(/time\.from/u);
    expect(store.searchSemantic).not.toHaveBeenCalled();
  });

  it("normalizes temporal filters before sending them to adapters", async () => {
    let receivedAt: string | null = null;
    const store: RetrievalStore = {
      searchSemantic: async (input) => {
        receivedAt = input.filter.time.at;
        return [];
      },
      searchFullText: async () => [],
      loadConnectedSubgraph: async () => ({
        concepts: [], claims: [], evidence: [], contexts: [], edges: [], graphClaimRanking: [],
      }),
    };
    const search = createSearchMemory({ embeddings, store });

    await search({
      projectId: "memoryos",
      query: "query",
      time: { at: "2026-08-30T15:00:00+03:00" },
    });

    expect(receivedAt).toBe("2026-08-30T12:00:00.000Z");
  });
});
