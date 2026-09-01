import { describe, expect, it, vi } from "vitest";
import { createListProjects, type ProjectCatalogStore } from "../src/modules/projects/index.js";

describe("list projects", () => {
  it("returns the store's isolated project overviews", async () => {
    const expected = [{
      project: {
        id: "project-1", name: "Project 1", description: null, repositoryUri: null,
        revision: 2, schemaVersion: 1 as const,
      },
      counts: { concepts: 3, claims: 2, evidence: 1, contexts: 1, reflectionEvents: 2 },
    }];
    const store: ProjectCatalogStore = { listProjectOverviews: vi.fn(async () => expected) };

    await expect(createListProjects(store)()).resolves.toEqual(expected);
  });
});
