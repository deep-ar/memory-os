import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";
import { FalkorDbMemoryReadStore } from "../src/adapters/memory/falkordb-memory-read-store.js";
import { FalkorDbRetrievalStore } from "../src/adapters/memory/falkordb-retrieval-store.js";
import { FalkorDbSearchIndexStore } from "../src/adapters/memory/falkordb-search-index-store.js";
import type { Project } from "../src/modules/knowledge/index.js";
import { createApplyMemoryDelta } from "../src/modules/reflection/index.js";
import {
  createSearchMemory,
  createReindexSearch,
  type EmbeddingProvider,
  type RetrievalFilter,
} from "../src/modules/retrieval/index.js";
import { parseApplyMemoryDeltaInput } from "../src/transports/contracts/apply-memory-delta.js";

const url = process.env.FALKORDB_INTEGRATION_URL;
const integration = url === undefined ? describe.skip : describe;
const graphName = `memoryos_retrieval_${process.pid}_${Date.now()}`;

const identity = {
  provider: "ollama" as const,
  model: "bge-m3:latest",
  digest: "retrieval-digest",
  dimension: 3,
};

function vectorFor(text: string): number[] {
  return /atomic|transaction|FalkorDB/iu.test(text) ? [1, 0, 0] : [0, 1, 0];
}

const embeddings: EmbeddingProvider = {
  describeModel: async () => identity,
  embed: async (texts) => ({
    identity,
    vectors: texts.map(vectorFor),
  }),
};

const filter: RetrievalFilter = {
  include: {
    active: true,
    disputed: false,
    historical: false,
    superseded: false,
    invalidated: false,
  },
  time: { at: null, from: null, to: null },
};

const project: Project = {
  id: "retrieval-project",
  name: "Retrieval project",
  description: null,
  repositoryUri: null,
  revision: 0,
  schemaVersion: 1,
};

function seedCommand() {
  return parseApplyMemoryDeltaInput({
    project_id: project.id,
    memory_delta: {
      expected_revision: 0,
      reflection: { trigger: "significant_test" },
      concepts: [
        {
          id: "concept-transaction",
          project_id: project.id,
          canonical_name: "Atomic transaction",
          description: "All graph mutations commit together",
          concept_type: "Mechanism",
          aliases: ["MemoryDelta"],
        },
        {
          id: "concept-partial-write",
          project_id: project.id,
          canonical_name: "Partial write",
          description: "An inconsistent persistence failure",
          concept_type: "Problem",
        },
      ],
      evidence: [{
        id: "evidence-transaction-test",
        project_id: project.id,
        type: "test",
        summary: "FalkorDB transaction test passes",
        content: "Concurrent writers leave one complete event and graph update.",
      }],
      contexts: [{
        id: "context-windows",
        project_id: project.id,
        name: "Windows local runtime",
        dimensions: {
          operating_system: "windows",
          application: "paseo",
          runtime: "node",
          environment: "development",
        },
        concept_ids: ["concept-transaction"],
      }],
      claims: [
        {
          id: "claim-atomic",
          project_id: project.id,
          subject_id: "concept-transaction",
          predicate: "PREVENTS",
          object_id: "concept-partial-write",
          statement: "An atomic transaction prevents partially visible memory writes",
          epistemic_basis: "tested",
          confidence_level: "verified",
          lifecycle_status: "active",
          context_ids: ["context-windows"],
          evidence_ids: ["evidence-transaction-test"],
          supports: ["claim-storage"],
        },
        {
          id: "claim-storage",
          project_id: project.id,
          subject_id: "concept-transaction",
          predicate: "USES",
          statement: "Memory OS uses FalkorDB for atomic graph storage",
          epistemic_basis: "decision",
          confidence_level: "established",
          lifecycle_status: "active",
        },
      ],
    },
  });
}

integration("FalkorDB hybrid retrieval", () => {
  let memory: FalkorDbMemoryStore;
  let retrieval: FalkorDbRetrievalStore;
  let inspector: FalkorDB;
  let indexStore: FalkorDbSearchIndexStore;
  let reads: FalkorDbMemoryReadStore;

  beforeAll(async () => {
    memory = await FalkorDbMemoryStore.connect({ url: url!, graphName });
    retrieval = await FalkorDbRetrievalStore.connect({ url: url!, graphName });
    inspector = await FalkorDB.connect({ url: url! });
    indexStore = await FalkorDbSearchIndexStore.connect({ url: url!, graphName });
    reads = await FalkorDbMemoryReadStore.connect({ url: url!, graphName });
    await memory.bootstrap({ embeddingDimension: 3 });
    await memory.registerProject(project);
    const apply = createApplyMemoryDelta({
      store: memory,
      embeddings,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "event-retrieval-seed" },
    });
    const result = await apply(seedCommand());
    expect(result.ok).toBe(true);
  });

  afterAll(async () => {
    await memory.close();
    await retrieval.close();
    await indexStore.close();
    await reads.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.close();
  });

  it("retrieves project-scoped vector and full-text entry points", async () => {
    const semantic = await retrieval.searchSemantic({
      projectId: project.id,
      vector: [1, 0, 0],
      identity,
      filter,
      limit: 10,
    });
    const fullText = await retrieval.searchFullText({
      projectId: project.id,
      query: "atomic transaction",
      filter,
      limit: 10,
    });

    expect(semantic.some((item) => item.entityId === "claim-atomic")).toBe(true);
    expect(semantic.at(-1)?.entityId).toBe("concept-partial-write");
    expect(fullText.some((item) => item.entityId === "concept-transaction")).toBe(true);
    expect(fullText.some((item) => item.entityId === "claim-atomic")).toBe(true);
  });

  it("accepts Markdown-escaped technical identifiers in full-text queries", async () => {
    await expect(retrieval.searchFullText({
      projectId: project.id,
      query: String.raw`можем навесить инструмент \_\_LucyTest просто скриптом`,
      filter,
      limit: 10,
    })).resolves.toBeDefined();
  });

  it("returns claims with connected concepts, evidence, contexts, and claim edges", async () => {
    const search = createSearchMemory({ embeddings, store: retrieval });

    const result = await search({
      projectId: project.id,
      query: "atomic transaction",
      context: { operatingSystem: "windows", application: "paseo" },
      graphDepth: 1,
      maxResults: 10,
    });

    expect(result.claims.map((claim) => claim.id)).toContain("claim-atomic");
    expect(result.concepts.map((concept) => concept.id)).toContain("concept-transaction");
    expect(result.evidence.map((item) => item.id)).toContain("evidence-transaction-test");
    expect(result.contexts.map((context) => context.id)).toContain("context-windows");
    expect(result.edges).toEqual(expect.arrayContaining([
      { from: "claim-atomic", to: "claim-storage", type: "SUPPORTS" },
      { from: "claim-atomic", to: "evidence-transaction-test", type: "SUPPORTED_BY" },
    ]));
  });

  it("applies transaction-time filtering before fusion", async () => {
    const semantic = await retrieval.searchSemantic({
      projectId: project.id,
      vector: [1, 0, 0],
      identity,
      filter: {
        ...filter,
        time: { at: "2026-08-29T00:00:00.000Z", from: null, to: null },
      },
      limit: 10,
    });

    expect(semantic).toEqual([]);
  });

  it("reads and explains claims with evidence, context, provenance and history", async () => {
    const revision = await reads.getProjectRevision(project.id);
    const exact = await reads.getClaim(project.id, "claim-atomic");
    const explanation = await reads.explainClaim(project.id, "claim-atomic");
    const supported = await reads.explainClaim(project.id, "claim-storage");

    expect(revision).toBe(1);
    expect(exact).toMatchObject({ id: "claim-atomic", subjectId: "concept-transaction" });
    expect(explanation).toMatchObject({
      claim: { id: "claim-atomic" },
      epistemicState: { basis: "tested", confidence: "verified", lifecycleStatus: "active" },
      supportingEvidence: [{
        id: "evidence-transaction-test",
        projectId: project.id,
        content: "Concurrent writers leave one complete event and graph update.",
        contentHash: null,
        schemaVersion: 1,
      }],
      contexts: [{ id: "context-windows" }],
      reflectionHistory: [{ id: "event-retrieval-seed" }],
    });
    expect(supported?.supportingClaims.map((claim) => claim.id)).toContain("claim-atomic");
  });

  it("returns conflict candidates without resolving or mutating them", async () => {
    const conflicts = await reads.findConflicts({
      projectId: project.id,
      subjectId: "concept-transaction",
      predicate: "USES",
      objectId: null,
      statement: "MemoryOS should use another graph storage engine",
      contextIds: [],
      validFrom: null,
      validTo: null,
    });

    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        claimId: "claim-storage",
        conflictReason: "same_subject_predicate",
        temporalOverlap: true,
      }),
    ]));
  });

  it("filters immutable reflection history by entity", async () => {
    const events = await reads.history({
      projectId: project.id,
      entityType: "claim",
      entityId: "claim-atomic",
      limit: 10,
    });

    expect(events).toEqual([
      expect.objectContaining({
        id: "event-retrieval-seed",
        trigger: "significant_test",
        operations: expect.arrayContaining([
          { type: "CREATE_CLAIM", entityId: "claim-atomic" },
        ]),
      }),
    ]);
  });

  it("atomically reindexes every document under one new digest", async () => {
    const newIdentity = { ...identity, digest: "retrieval-digest-v2" };
    const reindex = createReindexSearch({
      store: indexStore,
      embeddings: {
        describeModel: async () => newIdentity,
        embed: async (texts) => ({
          identity: newIdentity,
          vectors: texts.map(vectorFor),
        }),
      },
      now: () => "2026-08-30T13:00:00.000Z",
    });

    const result = await reindex();

    expect(result).toEqual({
      ok: true,
      updatedDocuments: 5,
      previousDigest: identity.digest,
      digest: newIdentity.digest,
    });
    const graph = inspector.selectGraph(graphName);
    const digests = await graph.roQuery<{
      readonly digest: string;
      readonly count: number;
    }>(`
      MATCH (node)
      WHERE node.embeddingDigest IS NOT NULL
      RETURN node.embeddingDigest AS digest, count(node) AS count
    `);
    expect(digests.data).toEqual([{ digest: newIdentity.digest, count: 5 }]);

    const stale = await retrieval.searchSemantic({
      projectId: project.id,
      vector: [1, 0, 0],
      identity,
      filter,
      limit: 10,
    });
    const current = await retrieval.searchSemantic({
      projectId: project.id,
      vector: [1, 0, 0],
      identity: newIdentity,
      filter,
      limit: 10,
    });
    expect(stale).toEqual([]);
    expect(current.length).toBeGreaterThan(0);

    const rejected = await indexStore.replaceSearchIndex({
      expectedIdentity: newIdentity,
      identity: { ...newIdentity, digest: "must-not-commit" },
      indexedAt: "2026-08-30T14:00:00.000Z",
      documents: [{
        projectId: project.id,
        entityId: "missing-concept",
        entityType: "concept",
        text: "missing",
        vector: [0, 0, 1],
      }],
    });
    expect(rejected).toEqual({ ok: false, actualIdentity: newIdentity });
    expect(await indexStore.getIndexIdentity()).toEqual(newIdentity);
  });
});
