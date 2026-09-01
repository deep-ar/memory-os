import type { MemoryBackend, SearchObservation } from "../domain/backend.js";
import type { BenchmarkDataset, EntityIdentity, SearchProbe } from "../domain/dataset.js";
import type { JsonValue } from "../domain/json.js";
import type { BenchmarkClock, DatasetDescriptor } from "../domain/run-context.js";
import { computeProbeMetrics, type ProbeMetrics } from "./metrics.js";

export interface ProbeReport {
  readonly id: string;
  readonly track: SearchProbe["track"];
  readonly projectId: string;
  readonly query: string;
  readonly durationMs: number;
  readonly status: "passed" | "failed";
  readonly ranked: readonly EntityIdentity[];
  readonly edges: SearchObservation["edges"];
  readonly metrics: ProbeMetrics | null;
  readonly error?: string;
}

export interface BenchmarkReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly profile: BenchmarkDataset["profile"];
  readonly dataset: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
    readonly sha256: string;
  };
  readonly backend: Readonly<Record<string, JsonValue>>;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "completed" | "failed";
  readonly setup: {
    readonly projectsCreated: number;
    readonly deltasApplied: number;
    readonly error?: string;
  };
  readonly probes: readonly ProbeReport[];
  readonly summary: {
    readonly attempted: number;
    readonly completed: number;
    readonly failed: number;
    readonly meanRecallAt1: number | null;
    readonly meanRecallAt5: number | null;
    readonly meanRecallAt10: number | null;
    readonly meanReciprocalRank: number | null;
    readonly meanNdcgAt10: number | null;
    readonly crossProjectLeakRate: number | null;
  };
}

const systemClock: BenchmarkClock = {
  instant: () => new Date().toISOString(),
  monotonicMilliseconds: () => performance.now(),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(probes: readonly ProbeReport[]): BenchmarkReport["summary"] {
  const successful = probes.filter((probe): probe is ProbeReport & { metrics: ProbeMetrics } => probe.metrics !== null);
  const isolation = successful.filter((probe) => probe.track === "isolation");
  return {
    attempted: probes.length,
    completed: successful.length,
    failed: probes.length - successful.length,
    meanRecallAt1: average(successful.map((probe) => probe.metrics.recallAt1)),
    meanRecallAt5: average(successful.map((probe) => probe.metrics.recallAt5)),
    meanRecallAt10: average(successful.map((probe) => probe.metrics.recallAt10)),
    meanReciprocalRank: average(successful.map((probe) => probe.metrics.meanReciprocalRank)),
    meanNdcgAt10: average(successful.map((probe) => probe.metrics.ndcgAt10)),
    crossProjectLeakRate: isolation.length === 0
      ? null
      : isolation.filter((probe) => probe.metrics.leakedForbidden.length > 0).length / isolation.length,
  };
}

export async function runKernelBenchmark(input: {
  readonly dataset: BenchmarkDataset;
  readonly descriptor: DatasetDescriptor;
  readonly backend: MemoryBackend;
  readonly allowExistingProjects?: boolean;
  readonly clock?: BenchmarkClock;
}): Promise<BenchmarkReport> {
  const clock = input.clock ?? systemClock;
  const startedAt = clock.instant();
  let backendDescription: Readonly<Record<string, JsonValue>> = { status: "unavailable" };
  let projectsCreated = 0;
  let deltasApplied = 0;
  let setupError: string | undefined;
  const probeReports: ProbeReport[] = [];

  try {
    backendDescription = await input.backend.describe();
    if (input.allowExistingProjects !== true) {
      const requestedProjectIds = input.dataset.projects.map((project) => project.id);
      const existingProjectIds = await input.backend.findExistingProjects(requestedProjectIds);
      if (existingProjectIds.length > 0) {
        throw new Error(`Benchmark projects already exist: ${existingProjectIds.join(", ")}; refusing a non-isolated benchmark run.`);
      }
    }
    for (const project of input.dataset.projects) {
      const registration = await input.backend.registerProject(project);
      if (!registration.created && input.allowExistingProjects !== true) {
        throw new Error(`Project '${project.id}' already exists; refusing a non-isolated benchmark run.`);
      }
      if (registration.created) projectsCreated += 1;
    }
    for (const delta of input.dataset.deltas) {
      await input.backend.applyDelta(delta);
      deltasApplied += 1;
    }
  } catch (error) {
    setupError = errorMessage(error);
  }

  if (setupError === undefined) {
    for (const probe of input.dataset.probes) {
      const before = clock.monotonicMilliseconds();
      try {
        const observation = await input.backend.search(probe);
        probeReports.push({
          id: probe.id,
          track: probe.track,
          projectId: probe.project_id,
          query: probe.query.text,
          durationMs: clock.monotonicMilliseconds() - before,
          status: "passed",
          ranked: observation.ranked,
          edges: observation.edges,
          metrics: computeProbeMetrics(observation.ranked, probe.gold.relevant, probe.gold.forbidden),
        });
      } catch (error) {
        probeReports.push({
          id: probe.id,
          track: probe.track,
          projectId: probe.project_id,
          query: probe.query.text,
          durationMs: clock.monotonicMilliseconds() - before,
          status: "failed",
          ranked: [],
          edges: [],
          metrics: null,
          error: errorMessage(error),
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    profile: input.dataset.profile,
    dataset: {
      id: input.dataset.id,
      version: input.dataset.version,
      source: input.descriptor.source,
      sha256: input.descriptor.sha256,
    },
    backend: backendDescription,
    startedAt,
    completedAt: clock.instant(),
    status: setupError === undefined && probeReports.every((probe) => probe.status === "passed") ? "completed" : "failed",
    setup: {
      projectsCreated,
      deltasApplied,
      ...(setupError === undefined ? {} : { error: setupError }),
    },
    probes: probeReports,
    summary: summarize(probeReports),
  };
}
