import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "../src/adapters/memory/in-memory-memory-store.js";
import type {
  ApplyMemoryDeltaCommand,
  Project,
} from "../src/modules/knowledge/index.js";
import {
  createApplyMemoryDelta,
  type Clock,
  type IdGenerator,
} from "../src/modules/reflection/index.js";
import type { EmbeddingProvider } from "../src/modules/retrieval/index.js";
import { EmbeddingFailure } from "../src/modules/retrieval/index.js";

const project: Project = {
  id: "memoryos",
  name: "Memory OS",
  description: null,
  repositoryUri: null,
  revision: 0,
  schemaVersion: 1,
};

const clock: Clock = {
  now: () => "2026-08-30T12:00:00.000Z",
};

const embeddings: EmbeddingProvider = {
  describeModel: async () => ({
    provider: "ollama",
    model: "bge-m3:latest",
    digest: "test-digest",
    dimension: 3,
  }),
  embed: async (texts) => ({
    identity: {
      provider: "ollama",
      model: "bge-m3:latest",
      digest: "test-digest",
      dimension: 3,
    },
    vectors: texts.map(() => [0.1, 0.2, 0.3]),
  }),
};

function ids(...values: string[]): IdGenerator {
  let index = 0;
  return {
    nextId: () => values[index++] ?? `generated-${index}`,
  };
}

function validCommand(): ApplyMemoryDeltaCommand {
  return {
    projectId: "memoryos",
    delta: {
      expectedRevision: 0,
      reflection: {
        agentId: "codex",
        agentType: "coding-agent",
        sessionId: "session-1",
        taskId: "task-1",
        workspaceId: "workspace-1",
        worktreeId: "main",
        branch: null,
        commit: null,
        trigger: "major_discovery",
      },
      concepts: [
        {
          id: "concept-memory-delta",
          projectId: "memoryos",
          canonicalName: "MemoryDelta",
          description: "Atomic memory write primitive",
          conceptType: "Mechanism",
          aliases: [],
        },
        {
          id: "concept-partial-write",
          projectId: "memoryos",
          canonicalName: "Partial memory write",
          description: null,
          conceptType: "Problem",
          aliases: [],
        },
      ],
      evidence: [
        {
          id: "evidence-spec",
          projectId: "memoryos",
          type: "documentation",
          summary: "Formal specification requires atomic MemoryDelta writes",
          content: null,
          sourceUri: null,
          repo: null,
          commit: null,
          branch: null,
          file: "Memory_OS_Specification_v1.0.md",
          symbol: null,
          lineStart: null,
          lineEnd: null,
          command: null,
          result: null,
          quote: null,
          observedAt: null,
          retrievedAt: null,
          contentHash: null,
        },
      ],
      contexts: [
        {
          id: "context-v1",
          projectId: "memoryos",
          name: "Memory OS v1",
          description: null,
          dimensions: {
            operatingSystem: null,
            application: "Memory OS",
            runtime: "Node.js",
            runtimeVersion: "24",
            framework: null,
            frameworkVersion: null,
            platform: "local",
            environment: "development",
          },
          conceptIds: ["concept-memory-delta"],
        },
      ],
      claims: [
        {
          id: "claim-delta-atomic",
          projectId: "memoryos",
          subjectId: "concept-memory-delta",
          predicate: "AVOIDS",
          objectId: "concept-partial-write",
          statement: "MemoryDelta prevents partially visible memory writes",
          epistemicBasis: "decision",
          confidenceLevel: "established",
          lifecycleStatus: "active",
          validFrom: "2026-08-30T00:00:00.000Z",
          validTo: null,
          lastVerifiedAt: null,
          contextIds: ["context-v1"],
          evidenceIds: ["evidence-spec"],
          supports: [],
          contradicts: [],
          supersedes: [],
          refines: [],
          derivedFrom: [],
        },
      ],
    },
  };
}

describe("apply MemoryDelta", () => {
  it("commits all entities and one immutable audit event", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("reflection-1"),
      embeddings,
    });

    const result = await apply(validCommand());

    expect(result).toEqual({
      ok: true,
      projectRevision: 1,
      reflectionEventId: "reflection-1",
      created: {
        concepts: ["concept-memory-delta", "concept-partial-write"],
        claims: ["claim-delta-atomic"],
        evidence: ["evidence-spec"],
        contexts: ["context-v1"],
      },
    });
    const view = store.inspectProject("memoryos");
    expect(view?.project.revision).toBe(1);
    expect(view?.events).toHaveLength(1);
    expect(view?.events[0]?.operations).toHaveLength(5);
    expect(view?.claims[0]?.provenance.reflectionEventId).toBe("reflection-1");
  });

  it("leaves memory unchanged when a reference is invalid", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("unused"),
      embeddings,
    });
    const original = validCommand();
    const originalClaim = original.delta.claims[0]!;
    const command: ApplyMemoryDeltaCommand = {
      ...original,
      delta: {
        ...original.delta,
        claims: [{ ...originalClaim, evidenceIds: ["missing-evidence"] }],
      },
    };

    const result = await apply(command);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_MEMORY_DELTA");
    }
    const view = store.inspectProject("memoryos");
    expect(view?.project.revision).toBe(0);
    expect(view?.concepts).toHaveLength(0);
    expect(view?.events).toHaveLength(0);
  });

  it("rejects cross-project entities", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("unused"),
      embeddings,
    });
    const original = validCommand();
    const firstConcept = original.delta.concepts[0]!;
    const command: ApplyMemoryDeltaCommand = {
      ...original,
      delta: {
        ...original.delta,
        concepts: [
          { ...firstConcept, projectId: "other-project" },
          ...original.delta.concepts.slice(1),
        ],
      },
    };

    const result = await apply(command);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "INVALID_MEMORY_DELTA") {
      expect(result.error.issues.some((issue) => issue.code === "PROJECT_BOUNDARY_VIOLATION")).toBe(true);
    }
  });

  it("returns MEMORY_CONFLICT for a stale expected revision", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("reflection-1", "reflection-2"),
      embeddings,
    });

    expect((await apply(validCommand())).ok).toBe(true);
    const staleResult = await apply(validCommand());

    expect(staleResult).toEqual({
      ok: false,
      error: {
        code: "MEMORY_CONFLICT",
        message: "Project revision changed to 1",
        actualRevision: 1,
      },
    });
    expect(store.inspectProject("memoryos")?.events).toHaveLength(1);
  });

  it("requires inferred claims to name source claims", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("unused"),
      embeddings,
    });
    const original = validCommand();
    const originalClaim = original.delta.claims[0]!;
    const command: ApplyMemoryDeltaCommand = {
      ...original,
      delta: {
        ...original.delta,
        claims: [{ ...originalClaim, epistemicBasis: "inferred" }],
      },
    };

    const result = await apply(command);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "INVALID_MEMORY_DELTA") {
      expect(result.error.issues.some((issue) => issue.code === "INVALID_EPISTEMIC_BASIS")).toBe(true);
    }
  });

  it("rejects secret material before embedding or persistence", async () => {
    const store = new InMemoryMemoryStore([project]);
    let embeddingCalled = false;
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("unused"),
      embeddings: {
        ...embeddings,
        embed: async (texts) => {
          embeddingCalled = true;
          return embeddings.embed(texts);
        },
      },
    });
    const original = validCommand();
    const originalEvidence = original.delta.evidence[0]!;
    const command: ApplyMemoryDeltaCommand = {
      ...original,
      delta: {
        ...original.delta,
        evidence: [{ ...originalEvidence, content: "api_key=super-secret-production-value" }],
      },
    };

    const result = await apply(command);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "INVALID_MEMORY_DELTA") {
      expect(result.error.issues).toContainEqual({
        code: "SENSITIVE_EVIDENCE",
        path: "delta.evidence[0].content",
        message: "Evidence must not contain credential or private-key material",
      });
    }
    expect(embeddingCalled).toBe(false);
    expect(store.inspectProject(project.id)?.evidence).toHaveLength(0);
  });

  it("allows explicitly redacted credential documentation", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({ store, clock, ids: ids("reflection-1"), embeddings });
    const original = validCommand();
    const originalEvidence = original.delta.evidence[0]!;
    const command: ApplyMemoryDeltaCommand = {
      ...original,
      delta: {
        ...original.delta,
        evidence: [{ ...originalEvidence, content: "api_key=redacted" }],
      },
    };

    expect((await apply(command)).ok).toBe(true);
  });

  it("does not mutate memory when embedding generation fails", async () => {
    const store = new InMemoryMemoryStore([project]);
    const apply = createApplyMemoryDelta({
      store,
      clock,
      ids: ids("reflection-unused"),
      embeddings: {
        ...embeddings,
        embed: async () => {
          throw new EmbeddingFailure("REQUEST_FAILED", "Ollama is unavailable");
        },
      },
    });

    const result = await apply(validCommand());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "EMBEDDING_FAILURE",
        message: "Ollama is unavailable",
        reason: "REQUEST_FAILED",
      },
    });
    expect(store.inspectProject(project.id)?.project.revision).toBe(0);
    expect(store.inspectProject(project.id)?.events).toHaveLength(0);
  });
});
