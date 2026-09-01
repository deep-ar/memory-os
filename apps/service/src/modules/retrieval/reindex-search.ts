import { EmbeddingFailure } from "./embedding-errors.js";
import type {
  EmbeddingProvider,
  SearchIndexMaintenanceStore,
} from "./ports.js";

export type ReindexSearchResult =
  | {
      readonly ok: true;
      readonly updatedDocuments: number;
      readonly previousDigest: string;
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "INDEX_NOT_INITIALIZED" | "INDEX_CONFLICT" | "INDEX_DIMENSION_CHANGE" | "EMBEDDING_FAILURE";
        readonly message: string;
      };
    };

export function createReindexSearch(dependencies: {
  readonly store: SearchIndexMaintenanceStore;
  readonly embeddings: EmbeddingProvider;
  readonly now: () => string;
}) {
  return async function reindexSearch(): Promise<ReindexSearchResult> {
    const current = await dependencies.store.getIndexIdentity();
    if (current === null) {
      return {
        ok: false,
        error: {
          code: "INDEX_NOT_INITIALIZED",
          message: "No embedding index exists yet.",
        },
      };
    }
    const documents = await dependencies.store.loadSearchDocuments();
    let batch;
    try {
      batch = await dependencies.embeddings.embed(
        documents.map((document) => document.text),
      );
    } catch (error) {
      if (error instanceof EmbeddingFailure) {
        return {
          ok: false,
          error: { code: "EMBEDDING_FAILURE", message: error.message },
        };
      }
      throw error;
    }
    if (batch.identity.dimension !== current.dimension) {
      return {
        ok: false,
        error: {
          code: "INDEX_DIMENSION_CHANGE",
          message: `Vector index dimension is ${current.dimension}, new model requires ${batch.identity.dimension}.`,
        },
      };
    }
    if (batch.vectors.length !== documents.length) {
      return {
        ok: false,
        error: {
          code: "EMBEDDING_FAILURE",
          message: "Embedding provider returned an incomplete reindex batch.",
        },
      };
    }

    const replaced = await dependencies.store.replaceSearchIndex({
      expectedIdentity: current,
      identity: batch.identity,
      indexedAt: dependencies.now(),
      documents: documents.map((document, index) => ({
        ...document,
        vector: batch.vectors[index]!,
      })),
    });
    if (!replaced.ok) {
      return {
        ok: false,
        error: {
          code: "INDEX_CONFLICT",
          message: "Embedding index identity changed while reindexing.",
        },
      };
    }
    return {
      ok: true,
      updatedDocuments: replaced.updatedDocuments,
      previousDigest: current.digest,
      digest: batch.identity.digest,
    };
  };
}

