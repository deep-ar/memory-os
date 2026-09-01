import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const current = {
  provider: "ollama" as const,
  model: "bge-m3:latest",
  digest: "current",
  dimension: 1024,
};

describe("service readiness", () => {
  it("is ready when the search index is empty or current", async () => {
    const app = createApp({
      readiness: {
        storage: "ready",
        embedding: current,
        embeddingIndex: { status: "empty" },
      },
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      embeddingIndex: { status: "empty" },
    });
    await app.close();
  });

  it("registers an explicit logical project through the administrative API", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      registerProject: async (command) => ({
        ok: true,
        created: true,
        project: {
          id: command.id, name: command.name, description: command.description ?? null,
          repositoryUri: command.repositoryUri ?? null, revision: 0, schemaVersion: 1,
        },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { project_id: "shared-project", name: "Shared project" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "created", project: { id: "shared-project", revision: 0 },
    });
    await app.close();
  });

  it("rejects DNS-rebinding and foreign browser origins on administrative writes", async () => {
    let registrations = 0;
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      allowedHostnames: ["127.0.0.1"],
      registerProject: async (command) => {
        registrations += 1;
        return {
          ok: true as const,
          created: true,
          project: {
            id: command.id, name: command.name, description: null, repositoryUri: null,
            revision: 0, schemaVersion: 1,
          },
        };
      },
    });

    const foreignHost = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { host: "attacker.example" },
      payload: { project_id: "blocked", name: "Blocked" },
    });
    const foreignOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { host: "127.0.0.1", origin: "https://attacker.example" },
      payload: { project_id: "blocked", name: "Blocked" },
    });

    expect(foreignHost.statusCode).toBe(403);
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json()).toMatchObject({
      error: { code: "REQUEST_ORIGIN_REJECTED" },
    });
    expect(registrations).toBe(0);
    await app.close();
  });

  it("returns 503 when a model update requires reindexing", async () => {
    const app = createApp({
      readiness: {
        storage: "ready",
        embedding: current,
        embeddingIndex: {
          status: "reindex_required",
          identity: { ...current, digest: "old" },
        },
      },
    });

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      embeddingIndex: { status: "reindex_required", identity: { digest: "old" } },
    });
    await app.close();
  });
});
