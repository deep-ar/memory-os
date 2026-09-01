import { describe, expect, it } from "vitest";
import type { PreparedMemoryDelta } from "../src/modules/knowledge/index.js";
import {
  createSearchDocuments,
  prepareSearchIndex,
  type EmbeddingProvider,
} from "../src/modules/retrieval/index.js";

const delta: PreparedMemoryDelta = {
  projectId: "memoryos",
  expectedRevision: 0,
  concepts: [{
    id: "concept-transaction",
    projectId: "memoryos",
    canonicalName: "Memory transaction",
    description: "Atomic graph and event write",
    conceptType: "Mechanism",
    aliases: ["MemoryDelta"],
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:00:00.000Z",
    schemaVersion: 1,
  }],
  claims: [],
  evidence: [],
  contexts: [],
  reflectionEvent: {
    id: "event-1",
    projectId: "memoryos",
    metadata: {
      agentId: null,
      agentType: null,
      sessionId: null,
      taskId: null,
      workspaceId: null,
      worktreeId: null,
      branch: null,
      commit: null,
      trigger: "manual",
    },
    createdAt: "2026-08-30T12:00:00.000Z",
    operations: [{ type: "CREATE_CONCEPT", entityId: "concept-transaction" }],
    schemaVersion: 1,
  },
};

describe("search index preparation", () => {
  it("builds provider-neutral embedding text", () => {
    expect(createSearchDocuments(delta)).toEqual([{
      projectId: "memoryos",
      entityId: "concept-transaction",
      entityType: "concept",
      text: "Memory transaction\nMemoryDelta\nAtomic graph and event write\nMechanism",
    }]);
  });

  it("keeps model identity beside every prepared batch", async () => {
    const provider: EmbeddingProvider = {
      describeModel: async () => ({
        provider: "ollama",
        model: "bge-m3:latest",
        digest: "digest-a",
        dimension: 3,
      }),
      embed: async (texts) => ({
        identity: {
          provider: "ollama",
          model: "bge-m3:latest",
          digest: "digest-a",
          dimension: 3,
        },
        vectors: texts.map(() => [0.1, 0.2, 0.3]),
      }),
    };

    const prepared = await prepareSearchIndex(delta, provider);

    expect(prepared.identity.digest).toBe("digest-a");
    expect(prepared.documents[0]?.vector).toEqual([0.1, 0.2, 0.3]);
  });
});

