import type { RankedReference } from "./ranking.js";
import type {
  IndexedSearchDocument,
  SearchDocument,
} from "./search-index.js";
import type {
  ConnectedSubgraph,
  RetrievalFilter,
} from "./types.js";

export interface EmbeddingModelIdentity {
  readonly provider: "ollama";
  readonly model: string;
  readonly digest: string;
  readonly dimension: number;
}

export interface EmbeddingBatch {
  readonly identity: EmbeddingModelIdentity;
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingProvider {
  describeModel(): Promise<EmbeddingModelIdentity>;
  embed(texts: readonly string[]): Promise<EmbeddingBatch>;
}

export interface RetrievalStore {
  searchSemantic(input: {
    readonly projectId: string;
    readonly vector: readonly number[];
    readonly identity: EmbeddingModelIdentity;
    readonly filter: RetrievalFilter;
    readonly limit: number;
  }): Promise<readonly RankedReference[]>;

  searchFullText(input: {
    readonly projectId: string;
    readonly query: string;
    readonly filter: RetrievalFilter;
    readonly limit: number;
  }): Promise<readonly RankedReference[]>;

  loadConnectedSubgraph(input: {
    readonly projectId: string;
    readonly entryPoints: readonly RankedReference[];
    readonly filter: RetrievalFilter;
    readonly graphDepth: number;
  }): Promise<ConnectedSubgraph>;
}

export type ReplaceSearchIndexResult =
  | { readonly ok: true; readonly updatedDocuments: number }
  | {
      readonly ok: false;
      readonly actualIdentity: EmbeddingModelIdentity | null;
    };

export interface SearchIndexMaintenanceStore {
  getIndexIdentity(): Promise<EmbeddingModelIdentity | null>;
  loadSearchDocuments(): Promise<readonly SearchDocument[]>;
  replaceSearchIndex(input: {
    readonly expectedIdentity: EmbeddingModelIdentity;
    readonly identity: EmbeddingModelIdentity;
    readonly documents: readonly IndexedSearchDocument[];
    readonly indexedAt: string;
  }): Promise<ReplaceSearchIndexResult>;
}
