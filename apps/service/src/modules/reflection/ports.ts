import type {
  PreparedMemoryDelta,
  ProjectId,
  ProjectSnapshot,
} from "../knowledge/index.js";
import type {
  EmbeddingModelIdentity,
  PreparedSearchIndex,
} from "../retrieval/index.js";

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  nextId(): string;
}

export type StoreCommitResult =
  | {
      readonly ok: true;
      readonly projectRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "MEMORY_CONFLICT";
      readonly actualRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "INDEX_IDENTITY_MISMATCH";
      readonly actualIdentity: EmbeddingModelIdentity;
    };

export interface MemoryWriteStore {
  loadProjectSnapshot(projectId: ProjectId): Promise<ProjectSnapshot | null>;
  commitPreparedDelta(
    delta: PreparedMemoryDelta,
    searchIndex: PreparedSearchIndex,
  ): Promise<StoreCommitResult>;
}
