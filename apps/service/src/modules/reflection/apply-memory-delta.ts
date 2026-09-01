import {
  validateCreateMemoryDelta,
  type ApplyMemoryDeltaCommand,
  type PreparedMemoryDelta,
  type Provenance,
  type ReflectionEvent,
  type ReflectionOperation,
} from "../knowledge/index.js";
import type { Clock, IdGenerator, MemoryWriteStore } from "./ports.js";
import {
  EmbeddingFailure,
  prepareSearchIndex,
  type EmbeddingProvider,
} from "../retrieval/index.js";

export type ApplyMemoryDeltaError =
  | {
      readonly code: "PROJECT_NOT_FOUND";
      readonly message: string;
    }
  | {
      readonly code: "INVALID_MEMORY_DELTA";
      readonly message: string;
      readonly issues: ReturnType<typeof validateCreateMemoryDelta>;
    }
  | {
      readonly code: "MEMORY_CONFLICT";
      readonly message: string;
      readonly actualRevision: number;
    }
  | {
      readonly code: "EMBEDDING_FAILURE";
      readonly message: string;
      readonly reason: string;
    }
  | {
      readonly code: "INDEX_FAILURE";
      readonly message: string;
    };

export type ApplyMemoryDeltaResult =
  | {
      readonly ok: true;
      readonly projectRevision: number;
      readonly reflectionEventId: string;
      readonly created: {
        readonly concepts: readonly string[];
        readonly claims: readonly string[];
        readonly evidence: readonly string[];
        readonly contexts: readonly string[];
      };
    }
  | {
      readonly ok: false;
      readonly error: ApplyMemoryDeltaError;
    };

function createOperations(command: ApplyMemoryDeltaCommand): ReflectionOperation[] {
  return [
    ...command.delta.concepts.map((item) => ({
      type: "CREATE_CONCEPT" as const,
      entityId: item.id,
    })),
    ...command.delta.claims.map((item) => ({
      type: "CREATE_CLAIM" as const,
      entityId: item.id,
    })),
    ...command.delta.evidence.map((item) => ({
      type: "CREATE_EVIDENCE" as const,
      entityId: item.id,
    })),
    ...command.delta.contexts.map((item) => ({
      type: "CREATE_CONTEXT" as const,
      entityId: item.id,
    })),
  ];
}

function prepareDelta(
  command: ApplyMemoryDeltaCommand,
  reflectionEventId: string,
  transactionTime: string,
): PreparedMemoryDelta {
  const normalizeInstant = (value: string | null): string | null =>
    value === null ? null : new Date(value).toISOString();
  const provenance: Provenance = {
    reflectionEventId,
    agentId: command.delta.reflection.agentId,
    agentType: command.delta.reflection.agentType,
    sessionId: command.delta.reflection.sessionId,
    taskId: command.delta.reflection.taskId,
    workspaceId: command.delta.reflection.workspaceId,
    worktreeId: command.delta.reflection.worktreeId,
    branch: command.delta.reflection.branch,
    commit: command.delta.reflection.commit,
  };
  const reflectionEvent: ReflectionEvent = {
    id: reflectionEventId,
    projectId: command.projectId,
    metadata: { ...command.delta.reflection },
    createdAt: transactionTime,
    operations: createOperations(command),
    schemaVersion: 1,
  };

  return {
    projectId: command.projectId,
    expectedRevision: command.delta.expectedRevision,
    concepts: command.delta.concepts.map((concept) => ({
      ...concept,
      aliases: [...concept.aliases],
      createdAt: transactionTime,
      updatedAt: transactionTime,
      schemaVersion: 1,
    })),
    claims: command.delta.claims.map((claim) => ({
      ...claim,
      contextIds: [...claim.contextIds],
      evidenceIds: [...claim.evidenceIds],
      supports: [...claim.supports],
      contradicts: [...claim.contradicts],
      supersedes: [...claim.supersedes],
      refines: [...claim.refines],
      derivedFrom: [...claim.derivedFrom],
      validFrom: normalizeInstant(claim.validFrom),
      validTo: normalizeInstant(claim.validTo),
      lastVerifiedAt: normalizeInstant(claim.lastVerifiedAt),
      createdAt: transactionTime,
      updatedAt: transactionTime,
      provenance: { ...provenance },
      schemaVersion: 1,
      revision: 1,
    })),
    evidence: command.delta.evidence.map((item) => ({
      ...item,
      observedAt: normalizeInstant(item.observedAt),
      retrievedAt: normalizeInstant(item.retrievedAt),
      createdAt: transactionTime,
      schemaVersion: 1,
    })),
    contexts: command.delta.contexts.map((context) => ({
      ...context,
      dimensions: { ...context.dimensions },
      conceptIds: [...context.conceptIds],
      createdAt: transactionTime,
      updatedAt: transactionTime,
      schemaVersion: 1,
    })),
    reflectionEvent,
  };
}

export function createApplyMemoryDelta(dependencies: {
  readonly store: MemoryWriteStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly embeddings: EmbeddingProvider;
}) {
  return async function applyMemoryDelta(
    command: ApplyMemoryDeltaCommand,
  ): Promise<ApplyMemoryDeltaResult> {
    const snapshot = await dependencies.store.loadProjectSnapshot(command.projectId);
    if (snapshot === null) {
      return {
        ok: false,
        error: {
          code: "PROJECT_NOT_FOUND",
          message: `Project '${command.projectId}' does not exist`,
        },
      };
    }

    if (snapshot.project.revision !== command.delta.expectedRevision) {
      return {
        ok: false,
        error: {
          code: "MEMORY_CONFLICT",
          message: `Project revision changed to ${snapshot.project.revision}`,
          actualRevision: snapshot.project.revision,
        },
      };
    }

    const issues = validateCreateMemoryDelta(command, snapshot);
    if (issues.length > 0) {
      return {
        ok: false,
        error: {
          code: "INVALID_MEMORY_DELTA",
          message: "MemoryDelta violates one or more knowledge invariants",
          issues,
        },
      };
    }

    const reflectionEventId = dependencies.ids.nextId();
    const prepared = prepareDelta(
      command,
      reflectionEventId,
      dependencies.clock.now(),
    );
    let searchIndex;
    try {
      searchIndex = await prepareSearchIndex(prepared, dependencies.embeddings);
    } catch (error) {
      if (error instanceof EmbeddingFailure) {
        return {
          ok: false,
          error: {
            code: "EMBEDDING_FAILURE",
            message: error.message,
            reason: error.reason,
          },
        };
      }
      throw error;
    }

    const committed = await dependencies.store.commitPreparedDelta(
      prepared,
      searchIndex,
    );
    if (!committed.ok) {
      if (committed.code === "INDEX_IDENTITY_MISMATCH") {
        return {
          ok: false,
          error: {
            code: "INDEX_FAILURE",
            message: `Embedding index uses '${committed.actualIdentity.model}' with digest '${committed.actualIdentity.digest}'; reindex is required`,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "MEMORY_CONFLICT",
          message: `Project revision changed to ${committed.actualRevision}`,
          actualRevision: committed.actualRevision,
        },
      };
    }

    return {
      ok: true,
      projectRevision: committed.projectRevision,
      reflectionEventId,
      created: {
        concepts: prepared.concepts.map((item) => item.id),
        claims: prepared.claims.map((item) => item.id),
        evidence: prepared.evidence.map((item) => item.id),
        contexts: prepared.contexts.map((item) => item.id),
      },
    };
  };
}
