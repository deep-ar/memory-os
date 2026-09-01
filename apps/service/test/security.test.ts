import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const current = { provider: "ollama" as const, model: "bge-m3", digest: "digest", dimension: 1024 };
const token = "memoryos-test-token-at-least-32-characters";

describe("MemoryOS network security", () => {
  it("fails configuration when external access has no strong token", () => {
    expect(() => loadConfig({ MEMORYOS_EXTERNAL_ACCESS: "true" })).toThrow("MEMORYOS_AUTH_TOKEN");
    expect(loadConfig({
      MEMORYOS_EXTERNAL_ACCESS: "true",
      MEMORYOS_AUTH_TOKEN: token,
    })).toMatchObject({ MEMORYOS_EXTERNAL_ACCESS: true, MEMORYOS_AUTH_TOKEN: token });
  });

  it("requires Bearer auth for data surfaces while keeping health observable", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      authToken: token,
      tools: {} as never,
      listProjects: async () => [],
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/projects" });
    const authenticated = await app.inject({
      method: "GET", url: "/api/v1/projects",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(health.statusCode).toBe(200);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toContain("Bearer");
    expect(authenticated.statusCode).toBe(200);
    await app.close();
  });
});
