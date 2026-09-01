import type {
  PreparedMemoryDelta,
  Project,
  ProjectId,
  ProjectSnapshot,
  ReflectionEvent,
  StoredClaim,
  StoredConcept,
  StoredContext,
  StoredEvidence,
} from "../../modules/knowledge/index.js";
import type {
  MemoryWriteStore,
  StoreCommitResult,
} from "../../modules/reflection/index.js";
import {
  isSameEmbeddingIndex,
  type EmbeddingModelIdentity,
  type IndexedSearchDocument,
  type PreparedSearchIndex,
} from "../../modules/retrieval/index.js";

interface ProjectState {
  readonly project: Project;
  readonly concepts: ReadonlyMap<string, StoredConcept>;
  readonly claims: ReadonlyMap<string, StoredClaim>;
  readonly evidence: ReadonlyMap<string, StoredEvidence>;
  readonly contexts: ReadonlyMap<string, StoredContext>;
  readonly events: readonly ReflectionEvent[];
  readonly searchIdentity: EmbeddingModelIdentity | null;
  readonly searchDocuments: ReadonlyMap<string, IndexedSearchDocument>;
}

export interface InMemoryProjectView {
  readonly project: Project;
  readonly concepts: readonly StoredConcept[];
  readonly claims: readonly StoredClaim[];
  readonly evidence: readonly StoredEvidence[];
  readonly contexts: readonly StoredContext[];
  readonly events: readonly ReflectionEvent[];
  readonly searchIdentity: EmbeddingModelIdentity | null;
  readonly searchDocuments: readonly IndexedSearchDocument[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

export class InMemoryMemoryStore implements MemoryWriteStore {
  readonly #projects = new Map<ProjectId, ProjectState>();

  constructor(projects: readonly Project[] = []) {
    projects.forEach((project) => {
      this.#projects.set(project.id, {
        project: deepFreeze(clone(project)),
        concepts: new Map(),
        claims: new Map(),
        evidence: new Map(),
        contexts: new Map(),
        events: [],
        searchIdentity: null,
        searchDocuments: new Map(),
      });
    });
  }

  async loadProjectSnapshot(projectId: ProjectId): Promise<ProjectSnapshot | null> {
    const state = this.#projects.get(projectId);
    if (state === undefined) {
      return null;
    }

    return {
      project: clone(state.project),
      conceptIds: new Set(state.concepts.keys()),
      claimIds: new Set(state.claims.keys()),
      evidenceIds: new Set(state.evidence.keys()),
      contextIds: new Set(state.contexts.keys()),
    };
  }

  async commitPreparedDelta(
    delta: PreparedMemoryDelta,
    searchIndex: PreparedSearchIndex,
  ): Promise<StoreCommitResult> {
    const state = this.#projects.get(delta.projectId);
    if (state === undefined) {
      throw new Error(`Project '${delta.projectId}' disappeared during commit`);
    }
    if (state.project.revision !== delta.expectedRevision) {
      return {
        ok: false,
        code: "MEMORY_CONFLICT",
        actualRevision: state.project.revision,
      };
    }
    if (
      state.searchIdentity !== null &&
      !isSameEmbeddingIndex(state.searchIdentity, searchIndex.identity)
    ) {
      return {
        ok: false,
        code: "INDEX_IDENTITY_MISMATCH",
        actualIdentity: clone(state.searchIdentity),
      };
    }

    const concepts = new Map(state.concepts);
    const claims = new Map(state.claims);
    const evidence = new Map(state.evidence);
    const contexts = new Map(state.contexts);
    const searchDocuments = new Map(state.searchDocuments);

    delta.concepts.forEach((item) => concepts.set(item.id, deepFreeze(clone(item))));
    delta.claims.forEach((item) => claims.set(item.id, deepFreeze(clone(item))));
    delta.evidence.forEach((item) => evidence.set(item.id, deepFreeze(clone(item))));
    delta.contexts.forEach((item) => contexts.set(item.id, deepFreeze(clone(item))));
    searchIndex.documents.forEach((item) =>
      searchDocuments.set(`${item.entityType}:${item.entityId}`, deepFreeze(clone(item))),
    );

    const projectRevision = state.project.revision + 1;
    const nextState: ProjectState = {
      project: deepFreeze({ ...state.project, revision: projectRevision }),
      concepts,
      claims,
      evidence,
      contexts,
      events: [...state.events, deepFreeze(clone(delta.reflectionEvent))],
      searchIdentity: deepFreeze(clone(searchIndex.identity)),
      searchDocuments,
    };
    this.#projects.set(delta.projectId, nextState);

    return { ok: true, projectRevision };
  }

  inspectProject(projectId: ProjectId): InMemoryProjectView | null {
    const state = this.#projects.get(projectId);
    if (state === undefined) {
      return null;
    }

    return clone({
      project: state.project,
      concepts: [...state.concepts.values()],
      claims: [...state.claims.values()],
      evidence: [...state.evidence.values()],
      contexts: [...state.contexts.values()],
      events: state.events,
      searchIdentity: state.searchIdentity,
      searchDocuments: [...state.searchDocuments.values()],
    });
  }
}
