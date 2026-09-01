import { describe, expect, it } from "vitest";
import {
  createReindexSearch,
  type EmbeddingProvider,
  type SearchIndexMaintenanceStore,
} from "../src/modules/retrieval/index.js";

describe("reindex search", () => {
  it("prepares all replacements before one compare-and-swap", async () => {
    let replacementDigest: string | null = null;
    const store: SearchIndexMaintenanceStore = {
      getIndexIdentity: async () => ({
        provider: "ollama",
        model: "bge-m3:latest",
        digest: "old",
        dimension: 3,
      }),
      loadSearchDocuments: async () => [
        { projectId: "p", entityId: "c", entityType: "concept", text: "concept" },
        { projectId: "p", entityId: "q", entityType: "claim", text: "claim" },
      ],
      replaceSearchIndex: async (input) => {
        replacementDigest = input.identity.digest;
        return { ok: true, updatedDocuments: input.documents.length };
      },
    };
    const embeddings: EmbeddingProvider = {
      describeModel: async () => ({ provider: "ollama", model: "bge-m3:latest", digest: "new", dimension: 3 }),
      embed: async (texts) => ({
        identity: { provider: "ollama", model: "bge-m3:latest", digest: "new", dimension: 3 },
        vectors: texts.map(() => [0, 1, 0]),
      }),
    };
    const reindex = createReindexSearch({
      store,
      embeddings,
      now: () => "2026-08-30T13:00:00.000Z",
    });

    await expect(reindex()).resolves.toEqual({
      ok: true,
      updatedDocuments: 2,
      previousDigest: "old",
      digest: "new",
    });
    expect(replacementDigest).toBe("new");
  });

  it("refuses a dimension change before mutating the index", async () => {
    let replaced = false;
    const store: SearchIndexMaintenanceStore = {
      getIndexIdentity: async () => ({ provider: "ollama", model: "old", digest: "old", dimension: 3 }),
      loadSearchDocuments: async () => [],
      replaceSearchIndex: async () => {
        replaced = true;
        return { ok: true, updatedDocuments: 0 };
      },
    };
    const embeddings: EmbeddingProvider = {
      describeModel: async () => ({ provider: "ollama", model: "new", digest: "new", dimension: 4 }),
      embed: async () => ({
        identity: { provider: "ollama", model: "new", digest: "new", dimension: 4 },
        vectors: [],
      }),
    };

    const result = await createReindexSearch({ store, embeddings, now: () => "now" })();

    expect(result).toMatchObject({ ok: false, error: { code: "INDEX_DIMENSION_CHANGE" } });
    expect(replaced).toBe(false);
  });
});

