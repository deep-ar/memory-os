import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryOsPublicBackend } from "../src/adapters/memoryos-backend.js";

afterEach(() => vi.unstubAllGlobals());

describe("MemoryOsPublicBackend HTTP contract", () => {
  it("maps readiness, project catalog and registration without leaking HTTP types", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/ready")) {
        return new Response(JSON.stringify({ status: "ready", embedding: { model: "bge-m3" } }), { status: 200 });
      }
      if (url.endsWith("/api/v1/projects") && init?.method !== "POST") {
        return new Response(JSON.stringify({
          projects: [
            { project: { id: "wanted" }, counts: {} },
            { project: { id: "unrelated" }, counts: {} }
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "created", project: { id: "wanted" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const backend = new MemoryOsPublicBackend({ serviceUrl: "http://127.0.0.1:17310" });

    await expect(backend.describe()).resolves.toMatchObject({
      adapter: "memoryos-public-mcp-http",
      readiness: { status: "ready" },
    });
    await expect(backend.findExistingProjects(["wanted", "missing"])).resolves.toEqual(["wanted"]);
    await expect(backend.registerProject({ id: "wanted", name: "Wanted" })).resolves.toEqual({ created: true });
  });

  it("rejects a malformed catalog response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ projects: [{ id: "wrong-shape" }] }), { status: 200 })));
    const backend = new MemoryOsPublicBackend({ serviceUrl: "http://127.0.0.1:17310" });

    await expect(backend.findExistingProjects(["wanted"])).rejects.toThrow(/Invalid project list response/u);
  });
});
