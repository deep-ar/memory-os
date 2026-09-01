import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../src/adapters/load-dataset.js";
import { parseDataset } from "../src/domain/dataset.js";

describe("benchmark dataset", () => {
  it("loads the controlled seed corpus and produces a content digest", async () => {
    const loaded = await loadDataset(resolve("datasets/controlled-v0.1.json"));

    expect(loaded.dataset.profile).toBe("controlled-v0.1");
    expect(loaded.dataset.projects).toHaveLength(2);
    expect(loaded.dataset.probes.map((probe) => probe.track)).toContain("isolation");
    expect(loaded.descriptor.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects gold entities that are simultaneously relevant and forbidden", () => {
    expect(() => parseDataset({
      schema_version: 1,
      id: "invalid",
      version: "1",
      title: "invalid",
      profile: "controlled-v0.1",
      projects: [{ id: "p", name: "p" }],
      deltas: [{
        id: "d",
        project_id: "p",
        memory_delta: {
          expected_revision: 0,
          reflection: { trigger: "manual" },
          concepts: [{ id: "c", project_id: "p", canonical_name: "c", concept_type: "topic" }],
        },
      }],
      probes: [{
        id: "q",
        track: "exact",
        project_id: "p",
        query: { text: "c" },
        gold: {
          relevant: [{ entity_type: "concept", entity_id: "c" }],
          forbidden: [{ entity_type: "concept", entity_id: "c" }],
        },
      }],
    })).toThrow(/both relevant and forbidden/u);
  });
});
