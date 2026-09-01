import type { DatasetDescriptor } from "../domain/run-context.js";
import {
  IntegratedAgentOutputSchema,
  type IntegratedAgent,
  type IntegratedAgentOutput,
  type IntegratedMemoryContext,
} from "../integrated/agent.js";
import { validateMemoryCitations } from "../integrated/citation-contract.js";
import { costVector, scalarStatistics, type CostVector, type ScalarStatistics } from "../integrated/metrics.js";
import { REAL_REPLAY_MODES, type RealReplayBundle, type RealReplayCheckpoint, type RealReplayMode } from "./model.js";
import type { RealReplayMemoryPreparation, RealReplayMemoryProvider } from "./memory-provider.js";

interface RealReplayValidation {
  readonly success: boolean;
  readonly expectedDecision: string;
  readonly actualDecision: string;
}

interface RealReplayRun {
  readonly checkpoint: RealReplayCheckpoint;
  readonly mode: RealReplayMode;
  readonly repetition: number;
  readonly status: "completed" | "failed";
  readonly rawOutput: string | null;
  readonly output: IntegratedAgentOutput | null;
  readonly validation: RealReplayValidation | null;
  readonly memory: IntegratedMemoryContext;
  readonly cost: CostVector | null;
  readonly error?: string;
}

interface ReplayModeMetrics {
  readonly runs: number;
  readonly completed: number;
  readonly correct: number;
  readonly decisionAccuracy: number;
  readonly retrievalTimeMs: ScalarStatistics | null;
  readonly wallTimeMs: ScalarStatistics | null;
  readonly agentSteps: ScalarStatistics | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly helpfulCitationRuns: number;
}

export interface RealReplayReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly track: "REAL_SESSION_REPLAY";
  readonly profile: RealReplayBundle["profile"];
  readonly dataset: { readonly id: string; readonly version: string; readonly source: string; readonly sha256: string };
  readonly goldStatus: RealReplayBundle["evaluation"]["gold_status"];
  readonly agent: ReturnType<IntegratedAgent["describe"]>;
  readonly repetitions: number;
  readonly modes: typeof REAL_REPLAY_MODES;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "exploratory_completed" | "completed" | "failed";
  readonly memoryPreparation: RealReplayMemoryPreparation | null;
  readonly runs: readonly RealReplayRun[];
  readonly metrics: {
    readonly modes: Readonly<Record<RealReplayMode, ReplayModeMetrics>>;
    readonly memoryNetGain: number;
    readonly paired: { readonly improved: number; readonly harmed: number; readonly unchanged: number; readonly comparable: number };
    readonly memoryHarm: { readonly harmful: number; readonly comparable: number; readonly rate: number | null };
    readonly explorationReductionAgentSteps: number | null;
  };
  readonly limitations: readonly string[];
}

const noMemory: IntegratedMemoryContext = { items: [], source: "none", retrievalTimeMs: 0, preparationTimeMs: 0 };
const failedMemory: IntegratedMemoryContext = { items: [], source: "failed", retrievalTimeMs: 0, preparationTimeMs: 0 };

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function requestFor(bundle: RealReplayBundle, checkpoint: RealReplayCheckpoint, mode: RealReplayMode, repetition: number, memory: IntegratedMemoryContext) {
  return {
    requestId: `${checkpoint.id}:${mode}:${repetition}`,
    datasetId: bundle.id,
    datasetVersion: bundle.version,
    promptVersion: "real-session-replay-prompt-v0.1",
    toolsetVersion: "decision-only-v0.1",
    responseContractVersion: "integrated-output-v0.1",
    mode,
    repetition,
    scenario: {
      id: checkpoint.id,
      projectId: bundle.project.id,
      family: "lucycocos-real-session",
      episodeIndex: checkpoint.source_turn_index,
      task: checkpoint.task,
      decisionOptions: checkpoint.decision_options,
      repositoryFiles: {},
      allowedChangePaths: [],
    },
    memory: memory.items.map(({ stale: _stale, ...item }) => item),
    instruction: "Choose exactly one supplied decision option. Do not inspect the host or change files. Return empty changes, concise observable trace events, and cite only supplied memory that influenced the decision.",
  } as const;
}

function modeMetrics(runs: readonly RealReplayRun[]): ReplayModeMetrics {
  const completed = runs.filter((run) => run.status === "completed");
  const correct = completed.filter((run) => run.validation?.success === true);
  return {
    runs: runs.length,
    completed: completed.length,
    correct: correct.length,
    decisionAccuracy: runs.length === 0 ? 0 : correct.length / runs.length,
    retrievalTimeMs: scalarStatistics(runs.map((run) => run.memory.retrievalTimeMs)),
    wallTimeMs: scalarStatistics(runs.flatMap((run) => run.cost?.wallTimeMs === null || run.cost === null ? [] : [run.cost.wallTimeMs])),
    agentSteps: scalarStatistics(runs.flatMap((run) => run.cost === null ? [] : [run.cost.agentSteps])),
    inputTokens: runs.reduce((sum, run) => sum + (run.cost?.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((sum, run) => sum + (run.cost?.outputTokens ?? 0), 0),
    helpfulCitationRuns: runs.filter((run) => run.output?.memory_citations.some((citation) => citation.influence === "helpful") === true).length,
  };
}

function pairKey(run: RealReplayRun): string { return `${run.checkpoint.id}:${run.repetition}`; }

function calculateMetrics(runs: readonly RealReplayRun[]): RealReplayReport["metrics"] {
  const modes = Object.fromEntries(REAL_REPLAY_MODES.map((mode) => [mode, modeMetrics(runs.filter((run) => run.mode === mode))])) as Readonly<Record<RealReplayMode, ReplayModeMetrics>>;
  const noByKey = new Map(runs.filter((run) => run.mode === "no_memory").map((run) => [pairKey(run), run]));
  let improved = 0;
  let harmed = 0;
  let unchanged = 0;
  let harmful = 0;
  const stepDeltas: number[] = [];
  for (const full of runs.filter((run) => run.mode === "full_memory_os")) {
    const baseline = noByKey.get(pairKey(full));
    if (baseline === undefined) continue;
    const noCorrect = baseline.validation?.success === true;
    const fullCorrect = full.validation?.success === true;
    if (!noCorrect && fullCorrect) improved += 1;
    else if (noCorrect && !fullCorrect) harmed += 1;
    else unchanged += 1;
    const citedHelpful = full.output?.memory_citations.some((citation) => citation.influence === "helpful") === true;
    if (noCorrect && !fullCorrect && citedHelpful) harmful += 1;
    if (noCorrect && fullCorrect && baseline.cost !== null && full.cost !== null) {
      stepDeltas.push(baseline.cost.agentSteps - full.cost.agentSteps);
    }
  }
  const comparable = improved + harmed + unchanged;
  return {
    modes,
    memoryNetGain: modes.full_memory_os.decisionAccuracy - modes.no_memory.decisionAccuracy,
    paired: { improved, harmed, unchanged, comparable },
    memoryHarm: { harmful, comparable, rate: comparable === 0 ? null : harmful / comparable },
    explorationReductionAgentSteps: stepDeltas.length === 0 ? null : stepDeltas.reduce((sum, value) => sum + value, 0) / stepDeltas.length,
  };
}

export async function runRealReplay(input: {
  readonly bundle: RealReplayBundle;
  readonly descriptor: DatasetDescriptor;
  readonly agent: IntegratedAgent;
  readonly memoryProvider: RealReplayMemoryProvider;
}): Promise<RealReplayReport> {
  const startedAt = new Date().toISOString();
  const runs: RealReplayRun[] = [];
  let memoryPreparation: RealReplayMemoryPreparation | null = null;
  try {
    memoryPreparation = await input.memoryProvider.prepare();
  } catch (error) {
    return {
      schemaVersion: 1,
      benchmark: "MemoryOS-Bench",
      track: "REAL_SESSION_REPLAY",
      profile: input.bundle.profile,
      dataset: { id: input.bundle.id, version: input.bundle.version, ...input.descriptor },
      goldStatus: input.bundle.evaluation.gold_status,
      agent: input.agent.describe(),
      repetitions: input.bundle.evaluation.repetitions,
      modes: REAL_REPLAY_MODES,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "failed",
      memoryPreparation: null,
      runs,
      metrics: calculateMetrics(runs),
      limitations: [`Memory preparation failed: ${errorMessage(error)}`],
    };
  }
  for (const checkpoint of input.bundle.evaluation.checkpoints) {
    for (let repetition = 1; repetition <= input.bundle.evaluation.repetitions; repetition += 1) {
      for (const mode of REAL_REPLAY_MODES) {
        let memory = mode === "no_memory" ? noMemory : failedMemory;
        let rawOutput: string | null = null;
        let output: IntegratedAgentOutput | null = null;
        let cost: CostVector | null = null;
        try {
          if (mode === "full_memory_os") memory = await input.memoryProvider.contextFor(checkpoint);
          const invocation = await input.agent.invoke(requestFor(input.bundle, checkpoint, mode, repetition, memory));
          rawOutput = invocation.rawOutput;
          output = IntegratedAgentOutputSchema.parse(JSON.parse(rawOutput));
          if (output.changes.length > 0) throw new Error("Real replay decision-only output must not contain file changes.");
          cost = costVector(output, invocation.wallTimeMs + memory.retrievalTimeMs);
          validateMemoryCitations({ mode, output, memory });
          const validation = {
            success: output.decision === checkpoint.expected_decision,
            expectedDecision: checkpoint.expected_decision,
            actualDecision: output.decision,
          };
          runs.push({ checkpoint, mode, repetition, status: "completed", rawOutput, output, validation, memory, cost });
        } catch (error) {
          runs.push({ checkpoint, mode, repetition, status: "failed", rawOutput, output, validation: null, memory, cost, error: errorMessage(error) });
        }
      }
    }
  }
  const allCompleted = runs.every((run) => run.status === "completed");
  const exploratory = input.bundle.evaluation.gold_status !== "human_approved";
  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    track: "REAL_SESSION_REPLAY",
    profile: input.bundle.profile,
    dataset: { id: input.bundle.id, version: input.bundle.version, ...input.descriptor },
    goldStatus: input.bundle.evaluation.gold_status,
    agent: input.agent.describe(),
    repetitions: input.bundle.evaluation.repetitions,
    modes: REAL_REPLAY_MODES,
    startedAt,
    completedAt: new Date().toISOString(),
    status: !allCompleted ? "failed" : exploratory ? "exploratory_completed" : "completed",
    memoryPreparation,
    runs,
    metrics: calculateMetrics(runs),
    limitations: [
      ...(exploratory ? ["Checkpoint gold is agent-derived draft evidence; results are exploratory until human approval."] : []),
      "The deterministic projection stores bounded completed-turn conclusions and does not claim semantic curator quality.",
      "The holdout is one LucyCocos root session, so results do not generalize to other projects or task families.",
    ],
  };
}
