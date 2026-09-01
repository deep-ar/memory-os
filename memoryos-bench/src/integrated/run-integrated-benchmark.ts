import type { DatasetDescriptor } from "../domain/run-context.js";
import type { IntegratedAgent, IntegratedAgentDescriptor, IntegratedMemoryContext, IntegratedMemoryContextProvider } from "./agent.js";
import { createIntegratedRequest, IntegratedAgentOutputSchema } from "./agent.js";
import { validateMemoryCitations } from "./citation-contract.js";
import { EXPERIMENTAL_MODES, type IntegratedDataset } from "./dataset.js";
import { calculateIntegratedMetrics, costVector, type IntegratedMetrics, type IntegratedRunRecord } from "./metrics.js";
import { evaluateWorkspaceResult } from "./workspace.js";

export interface IntegratedReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly track: "INTEGRATED";
  readonly profile: IntegratedDataset["profile"];
  readonly dataset: { readonly id: string; readonly version: string; readonly source: string; readonly sha256: string };
  readonly agent: IntegratedAgentDescriptor;
  readonly executionKind: "calibration_replay" | "external_agent" | "test_fake";
  readonly repetitions: number;
  readonly modes: typeof EXPERIMENTAL_MODES;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "completed" | "failed";
  readonly runs: readonly IntegratedRunRecord[];
  readonly metrics: IntegratedMetrics;
  readonly limitations: readonly string[];
  readonly regrade?: {
    readonly sourceReport: DatasetDescriptor;
    readonly reason: string;
    readonly recoveredRuns: number;
    readonly wallTimeMissingRuns: number;
  };
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

const failedMemory: IntegratedMemoryContext = { items: [], source: "failed", retrievalTimeMs: 0, preparationTimeMs: 0 };

export async function runIntegratedBenchmark(input: {
  readonly dataset: IntegratedDataset;
  readonly descriptor: DatasetDescriptor;
  readonly agent: IntegratedAgent;
  readonly memoryProvider: IntegratedMemoryContextProvider;
}): Promise<IntegratedReport> {
  const startedAt = new Date().toISOString();
  const runs: IntegratedRunRecord[] = [];
  for (const scenario of input.dataset.scenarios) {
    for (let repetition = 1; repetition <= input.dataset.repetitions; repetition += 1) {
      for (const mode of EXPERIMENTAL_MODES) {
        let memory = failedMemory;
        let rawOutput: string | null = null;
        let parsedOutput: ReturnType<typeof IntegratedAgentOutputSchema.parse> | null = null;
        let validation: ReturnType<typeof evaluateWorkspaceResult> | null = null;
        let cost: ReturnType<typeof costVector> | null = null;
        try {
          memory = await input.memoryProvider.contextFor(scenario, mode);
          const invocation = await input.agent.invoke(createIntegratedRequest({
            dataset: input.dataset,
            scenario,
            mode,
            repetition,
            memory: memory.items,
          }));
          rawOutput = invocation.rawOutput;
          const parsedJson: unknown = JSON.parse(invocation.rawOutput);
          const output = IntegratedAgentOutputSchema.parse(parsedJson);
          parsedOutput = output;
          cost = costVector(output, invocation.wallTimeMs + memory.retrievalTimeMs);
          validateMemoryCitations({ mode, output, memory });
          validation = evaluateWorkspaceResult(scenario, output);
          runs.push({
            scenario,
            mode,
            repetition,
            status: "completed",
            rawOutput,
            output,
            validation,
            memory,
            cost,
          });
        } catch (error) {
          runs.push({
            scenario,
            mode,
            repetition,
            status: "failed",
            rawOutput,
            output: parsedOutput,
            validation,
            memory,
            cost,
            error: message(error),
          });
        }
      }
    }
  }
  const agent = input.agent.describe();
  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    track: "INTEGRATED",
    profile: input.dataset.profile,
    dataset: { id: input.dataset.id, version: input.dataset.version, source: input.descriptor.source, sha256: input.descriptor.sha256 },
    agent,
    executionKind: agent.adapter === "replay" ? "calibration_replay" : agent.adapter === "stdio" ? "external_agent" : "test_fake",
    repetitions: input.dataset.repetitions,
    modes: EXPERIMENTAL_MODES,
    startedAt,
    completedAt: new Date().toISOString(),
    status: runs.every((run) => run.status === "completed") ? "completed" : "failed",
    runs,
    metrics: calculateIntegratedMetrics(runs),
    limitations: [
      ...runs.some((run) => ["fixture_backend", "fixture_full", "fixture_flat_rag"].includes(run.memory.source))
        ? ["Fixture backend contexts calibrate five-mode metrics but do not measure live MemoryOS or Flat RAG retrieval."]
        : [],
      ...runs.some((run) => run.memory.source === "fixture_oracle")
        ? ["Oracle Memory is intentionally fixture-injected as an upper-bound control and has no retrieval latency."]
        : [],
      ...runs.some((run) => run.memory.source === "memoryos_fixture_curated")
        ? ["Full Memory OS uses fixture-curated writes; it measures live storage/retrieval but not live Curator quality."]
        : [],
      "Stdio trace and token telemetry are supplied by the agent adapter; harness-measured wall time is independent.",
      "Exact controlled repository validation does not substitute for real build and deployment tracks.",
    ],
  };
}
