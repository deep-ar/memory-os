import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FullClaim, MemoryToolService } from "../src/modules/memory-tools/index.js";
import { createApp } from "../src/app.js";
import { InMemoryMemoryStore } from "../src/adapters/memory/in-memory-memory-store.js";
import { createApplyMemoryDelta } from "../src/modules/reflection/index.js";
import { createMemoryMcpHandler } from "../src/transports/mcp/index.js";

const current = {
  provider: "ollama" as const,
  model: "bge-m3:latest",
  digest: "current",
  dimension: 1024,
};

const claim: FullClaim = {
  id: "claim-1",
  subjectId: "concept-1",
  predicate: "USES",
  objectId: null,
  statement: "MemoryOS uses an explicit project id.",
  epistemicBasis: "decision",
  confidenceLevel: "established",
  lifecycleStatus: "active",
  validFrom: null,
  validTo: null,
  lastVerifiedAt: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  contextIds: [],
  evidenceIds: [],
  projectId: "project-1",
  supports: [], contradicts: [], supersedes: [], refines: [], derivedFrom: [],
  provenance: {
    reflectionEventId: "event-1", agentId: null, agentType: null, sessionId: null,
    taskId: null, workspaceId: null, worktreeId: null, branch: null, commit: null,
  },
  schemaVersion: 1,
  revision: 1,
};

function fakeTools(): MemoryToolService {
  return {
    async search() {
      return {
        query: "test",
        projectId: "project-1",
        projectRevision: 0,
        entryPoints: [], claims: [], concepts: [], evidence: [], contexts: [], edges: [],
        rankingMetadata: {
          algorithm: "RRF", channels: ["semantic", "full_text", "graph"],
          embeddingDigest: "current", graphDepth: 1,
        },
      };
    },
    async getContext(input) {
      return {
        projectId: input.projectId, projectRevision: 0, taskDescription: input.taskDescription,
        claims: [], concepts: [], evidence: [], contexts: [], edges: [],
        estimatedTokens: 1, tokenBudget: input.tokenBudget ?? 4_000, truncated: false,
      };
    },
    async findConcepts() { return { concepts: [] }; },
    async getClaim(input) { return input.claimId === claim.id ? claim : null; },
    async explainClaim() { return null; },
    async findConflicts() { return { potentialConflicts: [] }; },
    async applyDelta() {
      return {
        ok: true, projectRevision: 1, reflectionEventId: "event-1",
        created: { concepts: [], claims: [], evidence: [], contexts: [] },
      };
    },
    async history() { return { events: [] }; },
  };
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("MemoryOS MCP over Streamable HTTP", () => {
  it("advertises the eight canonical tools and returns structured results", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      mcp: createMemoryMcpHandler(fakeTools()),
      allowedHostnames: ["127.0.0.1"],
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "memoryos-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", address)));

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "memory.apply_delta",
      "memory.explain_claim",
      "memory.find_concepts",
      "memory.find_conflicts",
      "memory.get_claim",
      "memory.get_context",
      "memory.history",
      "memory.search",
    ]);

    const result = await client.callTool({
      name: "memory.get_claim",
      arguments: { project_id: "project-1", claim_id: "claim-1" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ claim: { id: "claim-1" } });
    await client.close();
    clients.splice(clients.indexOf(client), 1);
    await app.close();
  });

  it("returns a stable machine-readable not-found error", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      mcp: createMemoryMcpHandler(fakeTools()),
      allowedHostnames: ["127.0.0.1"],
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "memoryos-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", address)));

    const result = await client.callTool({
      name: "memory.get_claim",
      arguments: { project_id: "project-1", claim_id: "missing" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "failed",
      error: { code: "CLAIM_NOT_FOUND" },
    });
    await client.close();
    clients.splice(clients.indexOf(client), 1);
    await app.close();
  });

  it("exposes the same contract through the thin stdio-to-HTTP proxy", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      mcp: createMemoryMcpHandler(fakeTools()),
      allowedHostnames: ["127.0.0.1"],
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "memoryos-stdio-test", version: "1.0.0" });
    clients.push(client);
    const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const entry = fileURLToPath(new URL("../src/mcp-stdio.ts", import.meta.url));
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [tsx, entry],
      env: { MEMORYOS_HTTP_URL: new URL("/mcp", address).href },
      stderr: "pipe",
    }));

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "memory.apply_delta", "memory.explain_claim", "memory.find_concepts",
      "memory.find_conflicts", "memory.get_claim", "memory.get_context",
      "memory.history", "memory.search",
    ]);
    const result = await client.callTool({
      name: "memory.get_claim",
      arguments: { project_id: "project-1", claim_id: "claim-1" },
    });
    expect(result.structuredContent).toMatchObject({ claim: { id: "claim-1" } });
    await client.close();
    clients.splice(clients.indexOf(client), 1);
    await app.close();
  });

  it("keeps two agents on one project safe through optimistic MCP writes", async () => {
    const store = new InMemoryMemoryStore([{
      id: "shared-project", name: "Shared", description: null, repositoryUri: null,
      revision: 0, schemaVersion: 1,
    }]);
    let id = 0;
    const applyDelta = createApplyMemoryDelta({
      store,
      clock: { now: () => "2026-08-30T00:00:00.000Z" },
      ids: { nextId: () => `event-${++id}` },
      embeddings: {
        describeModel: async () => ({ ...current, dimension: 3 }),
        embed: async (texts) => ({
          identity: { ...current, dimension: 3 },
          vectors: texts.map(() => [1, 0, 0]),
        }),
      },
    });
    const tools = { ...fakeTools(), applyDelta } satisfies MemoryToolService;
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      mcp: createMemoryMcpHandler(tools),
      allowedHostnames: ["127.0.0.1"],
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const connect = async (name: string) => {
      const client = new Client({ name, version: "1.0.0" });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", address)));
      return client;
    };
    const [agentA, agentB] = await Promise.all([connect("agent-a"), connect("agent-b")]);
    const delta = (conceptId: string) => ({
      name: "memory.apply_delta",
      arguments: {
        project_id: "shared-project",
        memory_delta: {
          expected_revision: 0,
          reflection: { trigger: "task_complete" },
          concepts: [{
            id: conceptId, project_id: "shared-project", canonical_name: conceptId,
            description: null, concept_type: "Test", aliases: [],
          }],
        },
      },
    });
    const results = await Promise.all([
      agentA.callTool(delta("concept-a")),
      agentB.callTool(delta("concept-b")),
    ]);

    expect(results.filter((result) => result.isError !== true)).toHaveLength(1);
    expect(results.filter((result) => result.isError === true)).toHaveLength(1);
    expect(results.find((result) => result.isError === true)?.structuredContent).toMatchObject({
      error: { code: "MEMORY_CONFLICT" },
    });
    expect(store.inspectProject("shared-project")?.project.revision).toBe(1);
    expect(store.inspectProject("shared-project")?.events).toHaveLength(1);
    await Promise.all([agentA.close(), agentB.close()]);
    clients.splice(0);
    await app.close();
  });
});
