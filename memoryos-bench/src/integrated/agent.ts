import { z } from "zod";
import type { ExperimentalMode, IntegratedScenario, MemoryItem } from "./dataset.js";

const TraceEventSchema = z.object({
  type: z.enum(["agent_step", "tool_call", "shell_call", "file_read", "web_read", "test_run", "failed_attempt"]),
  name: z.string().min(1),
  known_failure_id: z.string().min(1).nullable().default(null),
}).strict();

export const IntegratedAgentOutputSchema = z.object({
  decision: z.string().min(1),
  changes: z.array(z.object({ path: z.string().min(1), content: z.string() }).strict()),
  trace: z.array(TraceEventSchema),
  memory_citations: z.array(z.object({
    memory_id: z.string().min(1),
    influence: z.enum(["helpful", "harmful", "neutral"]),
    stale: z.boolean(),
  }).strict()),
  cost: z.object({
    input_tokens: z.number().nonnegative().nullable(),
    output_tokens: z.number().nonnegative().nullable(),
    cached_tokens: z.number().nonnegative().nullable(),
    api_cost: z.number().nonnegative().nullable(),
    local_compute_time_ms: z.number().nonnegative().nullable(),
  }).strict(),
}).strict();

export type IntegratedAgentOutput = z.infer<typeof IntegratedAgentOutputSchema>;

export interface IntegratedAgentDescriptor {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly reasoningMode: string | null;
  readonly adapter: "replay" | "stdio" | "fake";
  readonly telemetrySource: "calibration_fixture" | "agent_adapter_reported" | "test_fake";
}

export interface IntegratedAgentRequest {
  readonly requestId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly promptVersion: string;
  readonly toolsetVersion: string;
  readonly responseContractVersion: string;
  readonly mode: ExperimentalMode;
  readonly repetition: number;
  readonly scenario: {
    readonly id: string;
    readonly projectId: string;
    readonly family: string;
    readonly episodeIndex: number;
    readonly task: string;
    readonly decisionOptions: readonly string[];
    readonly repositoryFiles: Readonly<Record<string, string>>;
    readonly allowedChangePaths: readonly string[];
  };
  readonly memory: readonly Omit<MemoryItem, "stale">[];
  readonly instruction: string;
}

export interface IntegratedInvocationResult {
  readonly rawOutput: string;
  readonly wallTimeMs: number;
}

export interface IntegratedAgent {
  describe(): IntegratedAgentDescriptor;
  invoke(request: IntegratedAgentRequest): Promise<IntegratedInvocationResult>;
  close(): Promise<void>;
}

export interface IntegratedMemoryContext {
  readonly items: readonly MemoryItem[];
  readonly source: "none" | "failed" | "fixture_oracle" | "fixture_backend" | "fixture_full" | "fixture_flat_rag" | "memoryos_oracle_writes" | "memoryos_fixture_curated" | "memoryos_real_session_projection" | "flat_rag";
  readonly retrievalTimeMs: number;
  readonly preparationTimeMs: number;
}

export interface IntegratedMemoryContextProvider {
  contextFor(scenario: IntegratedScenario, mode: ExperimentalMode): Promise<IntegratedMemoryContext>;
  close(): Promise<void>;
}

export class FixtureIntegratedMemoryContextProvider implements IntegratedMemoryContextProvider {
  async contextFor(scenario: IntegratedScenario, mode: ExperimentalMode): Promise<IntegratedMemoryContext> {
    if (mode === "no_memory") return { items: [], source: "none", retrievalTimeMs: 0, preparationTimeMs: 0 };
    const started = performance.now();
    const items = scenario.memory[mode];
    const source = mode === "oracle_memory" ? "fixture_oracle"
      : mode === "oracle_writes" ? "fixture_backend"
        : mode === "full_memory_os" ? "fixture_full" : "fixture_flat_rag";
    return { items, source, retrievalTimeMs: performance.now() - started, preparationTimeMs: 0 };
  }

  async close(): Promise<void> {}
}

export function createIntegratedRequest(input: {
  readonly dataset: IntegratedDatasetIdentity;
  readonly scenario: IntegratedScenario;
  readonly mode: ExperimentalMode;
  readonly repetition: number;
  readonly memory: readonly MemoryItem[];
}): IntegratedAgentRequest {
  return {
    requestId: `${input.scenario.id}:${input.mode}:${input.repetition}`,
    datasetId: input.dataset.id,
    datasetVersion: input.dataset.version,
    promptVersion: input.dataset.prompt_version,
    toolsetVersion: input.dataset.toolset_version,
    responseContractVersion: input.dataset.response_contract_version,
    mode: input.mode,
    repetition: input.repetition,
    scenario: {
      id: input.scenario.id,
      projectId: input.scenario.project_id,
      family: input.scenario.family,
      episodeIndex: input.scenario.episode_index,
      task: input.scenario.task,
      decisionOptions: input.scenario.decision_options,
      repositoryFiles: input.scenario.repository.files,
      allowedChangePaths: input.scenario.repository.allowed_change_paths,
    },
    memory: input.memory.map(({ stale: _stale, ...item }) => item),
    instruction: "Return strict JSON matching IntegratedAgentOutput. Change only allowed paths. Trace every relevant step and memory influence.",
  };
}

interface IntegratedDatasetIdentity {
  readonly id: string;
  readonly version: string;
  readonly prompt_version: string;
  readonly toolset_version: string;
  readonly response_contract_version: string;
}
