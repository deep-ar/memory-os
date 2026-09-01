import { describe, expect, it } from "vitest";
import type { MemoryBackend, SearchObservation } from "../src/domain/backend.js";
import { parseDataset, type BenchmarkDataset, type BenchmarkDelta, type BenchmarkProject, type SearchProbe } from "../src/domain/dataset.js";
import type { BenchmarkClock } from "../src/domain/run-context.js";
import { runKernelBenchmark } from "../src/kernel/run-benchmark.js";

function dataset(): BenchmarkDataset {
  return parseDataset({
    schema_version: 1,
    id: "kernel-test",
    version: "1",
    title: "kernel test",
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
      gold: { relevant: [{ entity_type: "concept", entity_id: "c" }] },
    }],
  });
}

class FakeBackend implements MemoryBackend {
  projects: BenchmarkProject[] = [];
  deltas: BenchmarkDelta[] = [];

  constructor(
    readonly existing = false,
    readonly observation: SearchObservation = { ranked: [{ entity_type: "concept", entity_id: "c" }], edges: [] },
  ) {}

  async describe() { return { adapter: "fake" } as const; }
  async findExistingProjects(_projectIds: readonly string[]) { return this.existing ? ["p"] : []; }
  async registerProject(project: BenchmarkProject) { this.projects.push(project); return { created: !this.existing }; }
  async applyDelta(delta: BenchmarkDelta) { this.deltas.push(delta); }
  async search(_probe: SearchProbe) { return this.observation; }
  async close() {}
}

class UnavailableBackend extends FakeBackend {
  override async describe(): Promise<never> { throw new Error("ready endpoint unavailable"); }
}

function clock(): BenchmarkClock {
  const monotonic = [10, 15];
  return {
    instant: () => "2026-09-01T00:00:00.000Z",
    monotonicMilliseconds: () => monotonic.shift() ?? 15,
  };
}

describe("runKernelBenchmark", () => {
  it("seeds through the backend port and reports independent metrics", async () => {
    const backend = new FakeBackend();
    const report = await runKernelBenchmark({
      dataset: dataset(),
      descriptor: { source: "fixture", sha256: "abc" },
      backend,
      clock: clock(),
    });

    expect(report.status).toBe("completed");
    expect(backend.projects).toHaveLength(1);
    expect(backend.deltas).toHaveLength(1);
    expect(report.probes[0]?.durationMs).toBe(5);
    expect(report.summary.meanRecallAt1).toBe(1);
  });

  it("refuses an existing project before applying deltas", async () => {
    const backend = new FakeBackend(true);
    const report = await runKernelBenchmark({
      dataset: dataset(),
      descriptor: { source: "fixture", sha256: "abc" },
      backend,
      clock: clock(),
    });

    expect(report.status).toBe("failed");
    expect(report.setup.error).toMatch(/Benchmark projects already exist/u);
    expect(backend.projects).toHaveLength(0);
    expect(backend.deltas).toHaveLength(0);
    expect(report.probes).toHaveLength(0);
  });

  it("returns a failed report when backend discovery fails", async () => {
    const report = await runKernelBenchmark({
      dataset: dataset(),
      descriptor: { source: "fixture", sha256: "abc" },
      backend: new UnavailableBackend(),
      clock: clock(),
    });

    expect(report.status).toBe("failed");
    expect(report.backend).toEqual({ status: "unavailable" });
    expect(report.setup.error).toBe("ready endpoint unavailable");
  });
});
