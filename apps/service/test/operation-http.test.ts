import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const current = { provider: "ollama" as const, model: "bge-m3", digest: "digest", dimension: 1024 };

describe("operations HTTP", () => {
  it("returns 503 with a machine-readable degraded integrity report", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      checkIntegrity: async () => ({
        status: "degraded", checkedAt: "2026-08-30T12:00:00.000Z",
        expectedSchemaVersion: 1, actualSchemaVersion: 1,
        counts: { projects: 1, concepts: 0, claims: 0, evidence: 0, contexts: 0, reflectionEvents: 0 },
        issues: [{
          code: "ORPHAN_ENTITY", severity: "error", count: 1,
          message: "orphan", projectIds: [],
        }],
      }),
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/integrity" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", issues: [{ code: "ORPHAN_ENTITY" }] });
    await app.close();
  });

  it("serves local Prometheus text and guards foreign origins", async () => {
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      allowedHostnames: ["localhost"],
      checkIntegrity: async () => ({
        status: "healthy", checkedAt: "2026-08-30T12:00:00.000Z",
        expectedSchemaVersion: 1, actualSchemaVersion: 1,
        counts: { projects: 1, concepts: 0, claims: 0, evidence: 0, contexts: 0, reflectionEvents: 0 },
        issues: [],
      }),
      metrics: { renderPrometheus: () => "memoryos_integrity_healthy 1\n" },
    });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    const blocked = await app.inject({
      method: "GET", url: "/metrics", headers: { origin: "https://attacker.example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("memoryos_integrity_healthy 1");
    expect(blocked.statusCode).toBe(403);
    await app.close();
  });

  it("requires explicit confirmation and exposes only a tombstone id for hard delete", async () => {
    const received: unknown[] = [];
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      hardDeleteEvidence: async (command) => {
        received.push(command);
        return { ok: true, auditId: "audit-1", deletedAt: "2026-08-30T12:00:00.000Z" };
      },
      checkIntegrity: async () => ({
        status: "healthy", checkedAt: "2026-08-30T12:00:00.000Z",
        expectedSchemaVersion: 1, actualSchemaVersion: 1,
        counts: { projects: 1, concepts: 0, claims: 0, evidence: 1, contexts: 0, reflectionEvents: 0 },
        issues: [],
      }),
    });
    const rejected = await app.inject({
      method: "DELETE", url: "/api/v1/projects/p/evidence/secret-evidence",
      payload: { reason: "credential", actor: "operator" },
    });
    const accepted = await app.inject({
      method: "DELETE", url: "/api/v1/projects/p/evidence/secret-evidence",
      payload: { reason: "credential", actor: "operator", confirmation: "DELETE_SENSITIVE_EVIDENCE" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      status: "deleted", auditId: "audit-1", deletedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(accepted.body).not.toContain("secret-evidence");
    expect(received).toEqual([{ projectId: "p", evidenceId: "secret-evidence", reason: "credential", actor: "operator" }]);
    await app.close();
  });
});
