import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";
import type {
  ApplyMemoryDeltaCommand,
  Project,
} from "../src/modules/knowledge/index.js";
import { createApplyMemoryDelta } from "../src/modules/reflection/index.js";
import type { EmbeddingProvider } from "../src/modules/retrieval/index.js";

const url = process.env.FALKORDB_INTEGRATION_URL;
const integration = url === undefined ? describe.skip : describe;
const graphName = `memoryos_integration_${process.pid}_${Date.now()}`;

const embeddings: EmbeddingProvider = {
  describeModel: async () => ({
    provider: "ollama",
    model: "bge-m3:latest",
    digest: "integration-digest",
    dimension: 3,
  }),
  embed: async (texts) => ({
    identity: {
      provider: "ollama",
      model: "bge-m3:latest",
      digest: "integration-digest",
      dimension: 3,
    },
    vectors: texts.map((_, index) => [1, index / 10, 0]),
  }),
};

const project = (id: string): Project => ({
  id,
  name: id,
  description: null,
  repositoryUri: null,
  revision: 0,
  schemaVersion: 1,
});

function conceptDelta(projectId: string, conceptId: string): ApplyMemoryDeltaCommand {
  return {
    projectId,
    delta: {
      expectedRevision: 0,
      reflection: {
        agentId: "integration-test",
        agentType: "test",
        sessionId: null,
        taskId: null,
        workspaceId: null,
        worktreeId: null,
        branch: null,
        commit: null,
        trigger: "manual",
      },
      concepts: [
        {
          id: conceptId,
          projectId,
          canonicalName: conceptId,
          description: null,
          conceptType: "Mechanism",
          aliases: [],
        },
      ],
      claims: [],
      evidence: [],
      contexts: [],
    },
  };
}

integration("FalkorDB MemoryWriteStore contract", () => {
  let store: FalkorDbMemoryStore;
  let inspector: FalkorDB;

  beforeAll(async () => {
    store = await FalkorDbMemoryStore.connect({ url: url!, graphName });
    inspector = await FalkorDB.connect({ url: url! });
    await store.bootstrap({ embeddingDimension: 3 });
    await store.bootstrap({ embeddingDimension: 3 });
    await store.registerProject(project("atomic-project"));
    await store.registerProject(project("concurrent-project"));
    await store.registerProject(project("identity-project"));
  });

  afterAll(async () => {
    await store.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.close();
  });

  it("persists the entity, project edge, event edge, and revision in one query", async () => {
    const apply = createApplyMemoryDelta({
      store,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "event-atomic" },
      embeddings,
    });

    const result = await apply(conceptDelta("atomic-project", "concept-atomic"));

    expect(result.ok).toBe(true);
    const graph = inspector.selectGraph(graphName);
    const persisted = await graph.roQuery<{
      readonly revision: number;
      readonly conceptId: string;
      readonly eventId: string;
      readonly embeddingDigest: string;
      readonly embeddingDimension: number;
    }>(`
      MATCH (project:Project {id: 'atomic-project'})-[:HAS_CONCEPT]->(concept:Concept {id: 'concept-atomic'})
      MATCH (event:ReflectionEvent)-[:CREATED]->(concept)
      RETURN project.revision AS revision,
             concept.id AS conceptId,
             event.id AS eventId,
             concept.embeddingDigest AS embeddingDigest,
             concept.embeddingDimension AS embeddingDimension
    `);
    expect(persisted.data).toEqual([
      {
        revision: 1,
        conceptId: "concept-atomic",
        eventId: "event-atomic",
        embeddingDigest: "integration-digest",
        embeddingDimension: 3,
      },
    ]);
  });

  it("lists isolated project overview counts", async () => {
    await store.registerProject(project("catalog-project"));
    const apply = createApplyMemoryDelta({
      store,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "event-catalog" },
      embeddings,
    });
    await apply(conceptDelta("catalog-project", "catalog-concept"));

    const overviews = await store.listProjectOverviews();
    expect(overviews.find((item) => item.project.id === "catalog-project")).toMatchObject({
      project: { revision: 1 },
      counts: { concepts: 1, claims: 0, evidence: 0, contexts: 0, reflectionEvents: 1 },
    });
  });

  it("allows only one concurrent writer at an expected revision", async () => {
    let eventNumber = 0;
    const apply = createApplyMemoryDelta({
      store,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => `event-concurrent-${++eventNumber}` },
      embeddings,
    });

    const results = await Promise.all([
      apply(conceptDelta("concurrent-project", "concept-a")),
      apply(conceptDelta("concurrent-project", "concept-b")),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failure = results.find((result) => !result.ok);
    expect(failure?.ok).toBe(false);
    if (failure !== undefined && !failure.ok) {
      expect(failure.error.code).toBe("MEMORY_CONFLICT");
      if (failure.error.code === "MEMORY_CONFLICT") {
        expect(failure.error.actualRevision).toBe(1);
      }
    }

    const snapshot = await store.loadProjectSnapshot("concurrent-project");
    expect(snapshot?.project.revision).toBe(1);
    expect(snapshot?.conceptIds.size).toBe(1);
  });

  it("preserves the graph and event journal across client reconnects", async () => {
    await store.close();
    store = await FalkorDbMemoryStore.connect({ url: url!, graphName });

    const snapshot = await store.loadProjectSnapshot("atomic-project");
    expect(snapshot?.project.revision).toBe(1);
    expect(snapshot?.conceptIds).toEqual(new Set(["concept-atomic"]));

    const history = await inspector.selectGraph(graphName).roQuery<{
      readonly eventId: string;
    }>(`
      MATCH (event:ReflectionEvent {projectId: 'atomic-project'})
      RETURN event.id AS eventId
    `);
    expect(history.data).toEqual([{ eventId: "event-atomic" }]);
  });

  it("rejects a different model identity without a partial graph write", async () => {
    const changedEmbeddings: EmbeddingProvider = {
      ...embeddings,
      embed: async (texts) => ({
        identity: {
          provider: "ollama",
          model: "bge-m3:latest",
          digest: "different-digest",
          dimension: 3,
        },
        vectors: texts.map(() => [0, 1, 0]),
      }),
    };
    const apply = createApplyMemoryDelta({
      store,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "event-identity-mismatch" },
      embeddings: changedEmbeddings,
    });

    const result = await apply(conceptDelta("identity-project", "concept-rejected"));

    expect(result).toMatchObject({ ok: false, error: { code: "INDEX_FAILURE" } });
    const snapshot = await store.loadProjectSnapshot("identity-project");
    expect(snapshot?.project.revision).toBe(0);
    expect(snapshot?.conceptIds.size).toBe(0);
    const events = await inspector.selectGraph(graphName).roQuery<{ readonly count: number }>(`
      MATCH (event:ReflectionEvent {projectId: 'identity-project'})
      RETURN count(event) AS count
    `);
    expect(events.data).toEqual([{ count: 0 }]);
  });
});
