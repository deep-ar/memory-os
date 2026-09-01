import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OllamaEmbeddingProvider } from "../src/adapters/embeddings/ollama-embedding-provider.js";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";
import { FalkorDbRetrievalStore } from "../src/adapters/memory/falkordb-retrieval-store.js";
import type { Project } from "../src/modules/knowledge/index.js";
import { createApplyMemoryDelta } from "../src/modules/reflection/index.js";
import { createSearchMemory } from "../src/modules/retrieval/index.js";
import { parseApplyMemoryDeltaInput } from "../src/transports/contracts/apply-memory-delta.js";

const falkorUrl = process.env.FALKORDB_INTEGRATION_URL;
const ollamaUrl = process.env.OLLAMA_INTEGRATION_URL;
const integration = falkorUrl === undefined || ollamaUrl === undefined ? describe.skip : describe;
const graphName = `memoryos_bge_${process.pid}_${Date.now()}`;

const project: Project = {
  id: "bge-project",
  name: "BGE multilingual fixture",
  description: null,
  repositoryUri: null,
  revision: 0,
  schemaVersion: 1,
};

integration("BGE-M3 hybrid retrieval acceptance", () => {
  let memory: FalkorDbMemoryStore;
  let retrieval: FalkorDbRetrievalStore;
  let inspector: FalkorDB;
  let embeddings: OllamaEmbeddingProvider;

  beforeAll(async () => {
    memory = await FalkorDbMemoryStore.connect({ url: falkorUrl!, graphName });
    retrieval = await FalkorDbRetrievalStore.connect({ url: falkorUrl!, graphName });
    inspector = await FalkorDB.connect({ url: falkorUrl! });
    embeddings = new OllamaEmbeddingProvider({
      baseUrl: ollamaUrl!,
      model: "bge-m3",
      expectedDimension: 1024,
      timeoutMs: 120_000,
    });
    await memory.bootstrap({ embeddingDimension: 1024 });
    await memory.registerProject(project);
    const apply = createApplyMemoryDelta({
      store: memory,
      embeddings,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "event-bge-seed" },
    });
    const command = parseApplyMemoryDeltaInput({
      project_id: project.id,
      memory_delta: {
        expected_revision: 0,
        reflection: { trigger: "significant_test" },
        concepts: [
          {
            id: "concept-atomic",
            project_id: project.id,
            canonical_name: "Атомарная транзакция базы данных",
            description: "Запись фиксируется полностью или полностью откатывается",
            concept_type: "Mechanism",
            aliases: ["atomic database transaction"],
          },
          {
            id: "concept-css",
            project_id: project.id,
            canonical_name: "CSS Grid layout",
            description: "Расположение элементов интерфейса по строкам и колонкам",
            concept_type: "Technology",
          },
        ],
        claims: [
          {
            id: "claim-atomic",
            project_id: project.id,
            subject_id: "concept-atomic",
            predicate: "PREVENTS",
            statement: "Атомарная транзакция предотвращает частично сохранённые изменения",
            epistemic_basis: "tested",
            confidence_level: "verified",
            lifecycle_status: "active",
          },
          {
            id: "claim-css",
            project_id: project.id,
            subject_id: "concept-css",
            predicate: "CONTROLS",
            statement: "CSS Grid управляет визуальной раскладкой веб-страницы",
            epistemic_basis: "observed",
            confidence_level: "supported",
            lifecycle_status: "active",
          },
        ],
      },
    });
    const result = await apply(command);
    expect(result.ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await memory.close();
    await retrieval.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.close();
  });

  it("finds Russian knowledge from an English technical query", async () => {
    const search = createSearchMemory({ embeddings, store: retrieval });

    const result = await search({
      projectId: project.id,
      query: "How can a database prevent partially committed writes?",
      maxResults: 2,
      graphDepth: 1,
    });

    expect(result.claims[0]?.id).toBe("claim-atomic");
    expect(result.concepts.some((concept) => concept.id === "concept-atomic")).toBe(true);
    expect(result.rankingMetadata.embeddingDigest).toMatch(/^[a-f0-9]{64}$/u);
  }, 120_000);
});

