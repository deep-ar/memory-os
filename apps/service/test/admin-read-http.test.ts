import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { FullClaim, MemoryToolService } from "../src/modules/memory-tools/index.js";

const current = { provider: "ollama" as const, model: "bge-m3:latest", digest: "digest", dimension: 1024 };

function tools(): MemoryToolService {
  return {
    search: vi.fn(async (input) => ({
      query: input.query, projectId: input.projectId, projectRevision: 4,
      claims: [], concepts: [], evidence: [], contexts: [], edges: [], entryPoints: [],
      rankingMetadata: {
        algorithm: "RRF" as const,
        channels: ["semantic", "full_text", "graph"] as const,
        embeddingDigest: "digest", graphDepth: 1,
      },
    })),
    getContext: vi.fn(),
    findConcepts: vi.fn(),
    getClaim: vi.fn(async (): Promise<FullClaim> => ({
      id: "claim-1", projectId: "project-1", predicate: "USES", statement: "MemoryOS uses MCP",
      subjectId: "memoryos", objectId: "mcp", lifecycleStatus: "active", epistemicBasis: "observed",
      confidenceLevel: "verified", validFrom: null, validTo: null, lastVerifiedAt: null,
      createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
      contextIds: [], evidenceIds: [],
      supports: [], contradicts: [], supersedes: [], refines: [], derivedFrom: [],
      provenance: { reflectionEventId: "event-1", agentId: "agent", agentType: "test", sessionId: null, taskId: null, workspaceId: null, worktreeId: null, branch: null, commit: null },
      schemaVersion: 1, revision: 1,
    })),
    explainClaim: vi.fn(async () => ({ claim: { id: "claim-1" }, supportingEvidence: [{ id: "evidence-1" }] } as never)),
    findConflicts: vi.fn(async () => ({
      potentialConflicts: [{ claimId: "claim-1" }, { claimId: "claim-2" }],
    } as never)),
    applyDelta: vi.fn(),
    history: vi.fn(async () => ({ events: [{ id: "event-1" }] } as never)),
  };
}

function app(memoryTools = tools()) {
  return createApp({
    readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
    allowedHostnames: ["localhost", "127.0.0.1"],
    tools: memoryTools,
    listProjects: async () => [{
      project: { id: "project-1", name: "Project 1", description: null, repositoryUri: null, revision: 4, schemaVersion: 1 },
      counts: { concepts: 1, claims: 1, evidence: 1, contexts: 0, reflectionEvents: 1 },
    }],
  });
}

describe("Admin HTTP read contract", () => {
  it("lists project overviews and executes project-scoped search", async () => {
    const memoryTools = tools();
    const server = app(memoryTools);
    const projects = await server.inject({ method: "GET", url: "/api/v1/projects" });
    const search = await server.inject({ method: "GET", url: "/api/v1/projects/project-1/search?q=MCP&limit=5" });

    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toMatchObject({ projects: [{ project: { id: "project-1" }, counts: { claims: 1 } }] });
    expect(search.statusCode).toBe(200);
    expect(memoryTools.search).toHaveBeenCalledWith({ projectId: "project-1", query: "MCP", maxResults: 5, graphDepth: 1 });
    await server.close();
  });

  it("provides explanation, conflict candidates, and immutable history", async () => {
    const memoryTools = tools();
    const server = app(memoryTools);
    const explanation = await server.inject({ method: "GET", url: "/api/v1/projects/project-1/claims/claim-1/explanation" });
    const conflicts = await server.inject({ method: "GET", url: "/api/v1/projects/project-1/claims/claim-1/conflicts" });
    const history = await server.inject({ method: "GET", url: "/api/v1/projects/project-1/history?entity_type=Claim&entity_id=claim-1" });

    expect(explanation.json()).toMatchObject({ claim: { id: "claim-1" }, supportingEvidence: [{ id: "evidence-1" }] });
    expect(conflicts.json()).toMatchObject({ potentialConflicts: [{ claimId: "claim-2" }] });
    expect(history.json()).toMatchObject({ events: [{ id: "event-1" }] });
    expect(memoryTools.findConflicts).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1", subjectId: "memoryos", predicate: "USES",
    }));
    await server.close();
  });

  it("validates paired history filters and rejects foreign origins", async () => {
    const server = app();
    const invalid = await server.inject({ method: "GET", url: "/api/v1/projects/project-1/history?entity_type=Claim" });
    const foreign = await server.inject({
      method: "GET", url: "/api/v1/projects", headers: { origin: "https://attacker.example" },
    });

    expect(invalid.statusCode).toBe(400);
    expect(foreign.statusCode).toBe(403);
    await server.close();
  });
});
