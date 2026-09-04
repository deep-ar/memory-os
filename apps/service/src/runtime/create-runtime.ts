import { createHash, randomUUID } from "node:crypto";
import { OllamaEmbeddingProvider } from "../adapters/embeddings/ollama-embedding-provider.js";
import { FalkorDbMemoryReadStore } from "../adapters/memory/falkordb-memory-read-store.js";
import { FalkorDbKnowledgeMapReadStore } from "../adapters/memory/falkordb-knowledge-map-read-store.js";
import { FalkorDbMemoryStore } from "../adapters/memory/falkordb-memory-store.js";
import { FalkorDbRetrievalStore } from "../adapters/memory/falkordb-retrieval-store.js";
import { FalkorDbSearchIndexStore } from "../adapters/memory/falkordb-search-index-store.js";
import { FalkorDbIntegrityStore } from "../adapters/memory/falkordb-integrity-store.js";
import { FalkorDbSensitiveDataStore } from "../adapters/memory/falkordb-sensitive-data-store.js";
import { LocalMetricsRegistry } from "../adapters/metrics/local-metrics-registry.js";
import type { AppReadiness } from "../app.js";
import type { ServiceConfig } from "../config.js";
import { createMemoryToolService, type MemoryToolService } from "../modules/memory-tools/index.js";
import { createKnowledgeMapService, type KnowledgeMapService } from "../modules/knowledge-map/index.js";
import { createCheckIntegrity, type IntegrityReport } from "../modules/integrity/index.js";
import { instrumentMemoryTools } from "../modules/observability/index.js";
import {
  createListProjects,
  createRegisterProject,
  type ProjectOverview,
  type ProjectRegistrationResult,
  type RegisterProjectCommand,
} from "../modules/projects/index.js";
import { createApplyMemoryDelta } from "../modules/reflection/index.js";
import { createSearchMemory, isSameEmbeddingIndex } from "../modules/retrieval/index.js";
import { createHardDeleteEvidence, type HardDeleteEvidenceCommand, type HardDeleteEvidenceResult } from "../modules/sensitive-data/index.js";

export interface MemoryOsRuntime {
  readonly tools: MemoryToolService;
  readonly knowledgeMap: KnowledgeMapService;
  readonly readiness: AppReadiness;
  readonly registerProject: (command: RegisterProjectCommand) => Promise<ProjectRegistrationResult>;
  readonly listProjects: () => Promise<readonly ProjectOverview[]>;
  readonly checkIntegrity: () => Promise<IntegrityReport>;
  readonly metrics: LocalMetricsRegistry;
  readonly hardDeleteEvidence: (command: HardDeleteEvidenceCommand) => Promise<HardDeleteEvidenceResult>;
  close(): Promise<void>;
}

export async function createRuntime(config: ServiceConfig): Promise<MemoryOsRuntime> {
  const resources: { close(): Promise<void> }[] = [];
  try {
    const memory = await FalkorDbMemoryStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(memory);
    const index = await FalkorDbSearchIndexStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(index);
    const retrieval = await FalkorDbRetrievalStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(retrieval);
    const reads = await FalkorDbMemoryReadStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(reads);
    const knowledgeMapReads = await FalkorDbKnowledgeMapReadStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(knowledgeMapReads);
    const integrity = await FalkorDbIntegrityStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(integrity);
    const sensitiveData = await FalkorDbSensitiveDataStore.connect({
      url: config.FALKORDB_URL,
      graphName: config.MEMORYOS_GRAPH_NAME,
    });
    resources.push(sensitiveData);

    await memory.bootstrap({ embeddingDimension: config.OLLAMA_EMBEDDING_DIMENSION });
    const embeddings = new OllamaEmbeddingProvider({
      baseUrl: config.OLLAMA_URL,
      model: config.OLLAMA_EMBEDDING_MODEL,
      expectedDimension: config.OLLAMA_EMBEDDING_DIMENSION,
    });
    const embeddingIdentity = await embeddings.describeModel();
    const indexIdentity = await index.getIndexIdentity();
    const embeddingIndex = indexIdentity === null
      ? { status: "empty" as const }
      : isSameEmbeddingIndex(indexIdentity, embeddingIdentity)
        ? { status: "ready" as const, identity: indexIdentity }
        : { status: "reindex_required" as const, identity: indexIdentity };
    const rawTools = createMemoryToolService({
      searchMemory: createSearchMemory({ embeddings, store: retrieval }),
      applyMemoryDelta: createApplyMemoryDelta({
        store: memory,
        embeddings,
        clock: { now: () => new Date().toISOString() },
        ids: { nextId: () => randomUUID() },
      }),
      reads,
    });
    const metrics = new LocalMetricsRegistry();
    const tools = instrumentMemoryTools({
      tools: rawTools,
      metrics,
      traces: {
        recordTrace: (trace) => console.info(JSON.stringify({ type: "memoryos.operation", ...trace })),
      },
      monotonicClock: { now: () => performance.now() },
    });

    return {
      tools,
      knowledgeMap: createKnowledgeMapService(knowledgeMapReads),
      readiness: { storage: "ready", embedding: embeddingIdentity, embeddingIndex },
      registerProject: createRegisterProject(memory),
      listProjects: createListProjects(memory),
      checkIntegrity: createCheckIntegrity({
        store: integrity,
        clock: { now: () => new Date().toISOString() },
      }),
      metrics,
      hardDeleteEvidence: createHardDeleteEvidence({
        store: sensitiveData,
        clock: { now: () => new Date().toISOString() },
        ids: { nextId: () => randomUUID() },
        hash: { sha256: (value) => createHash("sha256").update(value).digest("hex") },
      }),
      async close() {
        await Promise.all(resources.map((resource) => resource.close()));
      },
    };
  } catch (error) {
    await Promise.all(resources.map((resource) => resource.close()));
    throw error;
  }
}
