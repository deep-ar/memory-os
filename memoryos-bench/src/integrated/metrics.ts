import type { IntegratedAgentOutput, IntegratedMemoryContext } from "./agent.js";
import { EXPERIMENTAL_MODES, type ExperimentalMode, type IntegratedScenario } from "./dataset.js";
import type { WorkspaceValidation } from "./workspace.js";

export interface CostVector {
  readonly agentSteps: number;
  readonly toolCalls: number;
  readonly shellCalls: number;
  readonly fileReads: number;
  readonly webReads: number;
  readonly testsRun: number;
  readonly failedAttempts: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly wallTimeMs: number | null;
  readonly apiCost: number | null;
  readonly localComputeTimeMs: number | null;
}

export interface IntegratedRunRecord {
  readonly scenario: IntegratedScenario;
  readonly mode: ExperimentalMode;
  readonly repetition: number;
  readonly status: "completed" | "failed";
  readonly rawOutput: string | null;
  readonly output: IntegratedAgentOutput | null;
  readonly validation: WorkspaceValidation | null;
  readonly memory: IntegratedMemoryContext;
  readonly cost: CostVector | null;
  readonly error?: string;
}

export interface ScalarStatistics {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly sampleStandardDeviation: number | null;
  readonly normal95Ci: { readonly lower: number; readonly upper: number } | null;
}

export type CostStatistics = Readonly<Record<keyof Omit<CostVector, "inputTokens" | "outputTokens" | "cachedTokens" | "apiCost" | "localComputeTimeMs">, ScalarStatistics | null>> & {
  readonly inputTokens: ScalarStatistics | null;
  readonly outputTokens: ScalarStatistics | null;
  readonly cachedTokens: ScalarStatistics | null;
  readonly apiCost: ScalarStatistics | null;
  readonly localComputeTimeMs: ScalarStatistics | null;
};

export interface ModeMetrics {
  readonly runs: number;
  readonly completed: number;
  readonly successful: number;
  readonly taskSuccessRate: number;
  readonly taskSuccessRateStatistics: ScalarStatistics;
  readonly decisionAccuracy: number;
  readonly fileAccuracy: number;
  readonly taskSuccessDeltaVsNoMemory: number;
  readonly memoryRetrievalTimeMs: ScalarStatistics;
  readonly memoryPreparationTimeMs: ScalarStatistics;
  readonly costOfCorrectResolution: CostStatistics;
}

export interface IntegratedMetrics {
  readonly modes: Readonly<Record<ExperimentalMode, ModeMetrics>>;
  readonly gaps: {
    readonly potentialMemoryGain: number;
    readonly retrievalGap: number;
    readonly curationGap: number;
    readonly memoryNetGain: number;
  };
  readonly repeatedMistakeRate: { readonly repeated: number; readonly opportunities: number; readonly rate: number | null };
  readonly positiveTransferRate: { readonly positive: number; readonly opportunities: number; readonly rate: number | null };
  readonly negativeTransferRate: { readonly negative: number; readonly opportunities: number; readonly rate: number | null };
  readonly staleKnowledgeUsageRate: { readonly staleUsed: number; readonly opportunities: number; readonly rate: number | null };
  readonly staleKnowledgeRecognitionRate: { readonly recognized: number; readonly citedStale: number; readonly rate: number | null };
  readonly memoryHarmRate: { readonly harmful: number; readonly comparable: number; readonly rate: number | null };
  readonly explorationReduction: Readonly<Record<keyof Pick<CostVector, "agentSteps" | "toolCalls" | "shellCalls" | "fileReads" | "testsRun" | "failedAttempts" | "wallTimeMs">, number | null>>;
  readonly learningCurveSlope: Readonly<Record<string, number | null>>;
}

const costKeys = [
  "agentSteps", "toolCalls", "shellCalls", "fileReads", "webReads", "testsRun", "failedAttempts",
  "inputTokens", "outputTokens", "cachedTokens", "wallTimeMs", "apiCost", "localComputeTimeMs",
] as const;

export function costVector(output: IntegratedAgentOutput, wallTimeMs: number | null): CostVector {
  const count = (type: IntegratedAgentOutput["trace"][number]["type"]) => output.trace.filter((event) => event.type === type).length;
  return {
    agentSteps: count("agent_step"),
    toolCalls: count("tool_call"),
    shellCalls: count("shell_call"),
    fileReads: count("file_read"),
    webReads: count("web_read"),
    testsRun: count("test_run"),
    failedAttempts: count("failed_attempt"),
    inputTokens: output.cost.input_tokens,
    outputTokens: output.cost.output_tokens,
    cachedTokens: output.cost.cached_tokens,
    wallTimeMs,
    apiCost: output.cost.api_cost,
    localComputeTimeMs: output.cost.local_compute_time_ms,
  };
}

export function scalarStatistics(values: readonly number[]): ScalarStatistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
  const percentile = (quantile: number): number => {
    const position = (sorted.length - 1) * quantile;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const lowerValue = sorted[lower] ?? 0;
    const upperValue = sorted[upper] ?? lowerValue;
    return lowerValue + (upperValue - lowerValue) * (position - lower);
  };
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);
  if (values.length === 1) return { count: 1, mean, median, p95, p99, sampleStandardDeviation: null, normal95Ci: null };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const sampleStandardDeviation = Math.sqrt(variance);
  const halfWidth = 1.96 * sampleStandardDeviation / Math.sqrt(values.length);
  return {
    count: values.length,
    mean,
    median,
    p95,
    p99,
    sampleStandardDeviation,
    normal95Ci: { lower: mean - halfWidth, upper: mean + halfWidth },
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function modeMetrics(runs: readonly IntegratedRunRecord[], noMemorySuccess: number): ModeMetrics {
  const completed = runs.filter((run) => run.status === "completed");
  const successful = completed.filter((run) => run.validation?.success === true);
  const successValues = runs.map((run) => run.validation?.success === true ? 1 : 0);
  const successRate = runs.length === 0 ? 0 : successful.length / runs.length;
  const decisionAccuracy = runs.length === 0 ? 0 : runs.filter((run) => run.validation?.decisionCorrect === true).length / runs.length;
  const fileAccuracy = runs.length === 0 ? 0 : runs.filter((run) => run.validation?.filesCorrect === true).length / runs.length;
  const costEntries = successful.flatMap((run) => run.cost === null ? [] : [run.cost]);
  const costStats = Object.fromEntries(costKeys.map((key) => [
    key,
    scalarStatistics(costEntries.flatMap((cost) => cost[key] === null ? [] : [cost[key] as number])),
  ])) as CostStatistics;
  return {
    runs: runs.length,
    completed: completed.length,
    successful: successful.length,
    taskSuccessRate: successRate,
    taskSuccessRateStatistics: scalarStatistics(successValues)!,
    decisionAccuracy,
    fileAccuracy,
    taskSuccessDeltaVsNoMemory: successRate - noMemorySuccess,
    memoryRetrievalTimeMs: scalarStatistics(runs.map((run) => run.memory.retrievalTimeMs))!,
    memoryPreparationTimeMs: scalarStatistics(runs.map((run) => run.memory.preparationTimeMs))!,
    costOfCorrectResolution: costStats,
  };
}

function paired(runs: readonly IntegratedRunRecord[], mode: ExperimentalMode): Map<string, IntegratedRunRecord> {
  return new Map(runs.filter((run) => run.mode === mode).map((run) => [`${run.scenario.id}:${run.repetition}`, run]));
}

function linearSlope(points: readonly { readonly x: number; readonly y: number }[]): number | null {
  if (points.length < 2) return null;
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator === 0) return null;
  return points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator;
}

export function calculateIntegratedMetrics(runs: readonly IntegratedRunRecord[]): IntegratedMetrics {
  const rawSuccess = (mode: ExperimentalMode) => {
    const modeRuns = runs.filter((run) => run.mode === mode);
    return modeRuns.length === 0 ? 0 : modeRuns.filter((run) => run.validation?.success === true).length / modeRuns.length;
  };
  const noMemorySuccess = rawSuccess("no_memory");
  const modes = Object.fromEntries(EXPERIMENTAL_MODES.map((mode) => [
    mode,
    modeMetrics(runs.filter((run) => run.mode === mode), noMemorySuccess),
  ])) as Readonly<Record<ExperimentalMode, ModeMetrics>>;

  let repeated = 0;
  let repeatedOpportunities = 0;
  let positive = 0;
  let positiveOpportunities = 0;
  let negative = 0;
  let negativeOpportunities = 0;
  let staleUsed = 0;
  let staleOpportunities = 0;
  let staleRecognized = 0;
  let citedStale = 0;
  for (const run of runs) {
    repeatedOpportunities += run.scenario.validator.known_failure_ids.length;
    const repeatedIds = new Set(run.output?.trace.flatMap((event) => event.type === "failed_attempt" && event.known_failure_id !== null ? [event.known_failure_id] : []) ?? []);
    repeated += run.scenario.validator.known_failure_ids.filter((id) => repeatedIds.has(id)).length;
    if (run.mode === "no_memory") continue;
    const memoryById = new Map(run.memory.items.map((item) => [item.id, item]));
    const hasCrossProjectOpportunity = run.memory.items.some((item) => item.source_project_id !== run.scenario.project_id);
    if (hasCrossProjectOpportunity) {
      positiveOpportunities += 1;
      if (run.validation?.success === true && run.output?.memory_citations.some((citation) =>
        citation.influence === "helpful" && run.scenario.validator.positive_transfer_memory_ids.includes(citation.memory_id),
      )) positive += 1;
    }
    if (run.memory.items.length > 0) {
      negativeOpportunities += 1;
      if (run.validation?.success !== true && run.output?.memory_citations.some((citation) =>
        citation.influence === "helpful" && memoryById.get(citation.memory_id)?.stale === true,
      )) negative += 1;
    }
    if (run.memory.items.some((item) => item.stale || run.scenario.validator.stale_memory_ids.includes(item.id))) {
      staleOpportunities += 1;
      const staleCitations = run.output?.memory_citations.filter((citation) => memoryById.get(citation.memory_id)?.stale === true) ?? [];
      if (staleCitations.some((citation) => citation.influence === "helpful")) staleUsed += 1;
      citedStale += staleCitations.length;
      staleRecognized += staleCitations.filter((citation) => citation.stale || citation.influence === "harmful").length;
    }
  }

  const noMemory = paired(runs, "no_memory");
  const fullMemory = paired(runs, "full_memory_os");
  let harmful = 0;
  let comparable = 0;
  const pairedCorrect: { no: CostVector; full: CostVector }[] = [];
  for (const [key, noRun] of noMemory) {
    const fullRun = fullMemory.get(key);
    if (fullRun === undefined) continue;
    comparable += 1;
    const fullMemoryById = new Map(fullRun.memory.items.map((item) => [item.id, item]));
    const harmfulCitation = fullRun.output?.memory_citations.some((citation) =>
      citation.influence === "helpful" && fullMemoryById.get(citation.memory_id)?.stale === true,
    ) === true;
    if (noRun.validation?.success === true && fullRun.validation?.success !== true && harmfulCitation) harmful += 1;
    if (noRun.validation?.success === true && fullRun.validation?.success === true && noRun.cost !== null && fullRun.cost !== null) {
      pairedCorrect.push({ no: noRun.cost, full: fullRun.cost });
    }
  }
  const reductionKeys = ["agentSteps", "toolCalls", "shellCalls", "fileReads", "testsRun", "failedAttempts", "wallTimeMs"] as const;
  const explorationReduction = Object.fromEntries(reductionKeys.map((key) => {
    const comparableCosts = pairedCorrect.filter((pair) => pair.no[key] !== null && pair.full[key] !== null);
    return [
      key,
      comparableCosts.length === 0 ? null : comparableCosts.reduce(
        (sum, pair) => sum + (pair.no[key] as number) - (pair.full[key] as number), 0,
      ) / comparableCosts.length,
    ];
  })) as IntegratedMetrics["explorationReduction"];

  const families = new Set(runs.map((run) => run.scenario.family));
  const learningCurveSlope = Object.fromEntries([...families].map((family) => {
    const fullSuccessful = runs.filter((run) => run.mode === "full_memory_os" && run.scenario.family === family && run.validation?.success === true && run.cost !== null);
    const byEpisode = new Map<number, number[]>();
    for (const run of fullSuccessful) {
      const values = byEpisode.get(run.scenario.episode_index) ?? [];
      values.push((run.cost?.agentSteps ?? 0) + (run.cost?.toolCalls ?? 0) + (run.cost?.fileReads ?? 0) + (run.cost?.failedAttempts ?? 0));
      byEpisode.set(run.scenario.episode_index, values);
    }
    return [family, linearSlope([...byEpisode].map(([x, values]) => ({ x, y: values.reduce((sum, value) => sum + value, 0) / values.length })))] as const;
  }));

  return {
    modes,
    gaps: {
      potentialMemoryGain: modes.oracle_memory.taskSuccessRate - modes.no_memory.taskSuccessRate,
      retrievalGap: modes.oracle_memory.taskSuccessRate - modes.oracle_writes.taskSuccessRate,
      curationGap: modes.oracle_writes.taskSuccessRate - modes.full_memory_os.taskSuccessRate,
      memoryNetGain: modes.full_memory_os.taskSuccessRate - modes.no_memory.taskSuccessRate,
    },
    repeatedMistakeRate: { repeated, opportunities: repeatedOpportunities, rate: rate(repeated, repeatedOpportunities) },
    positiveTransferRate: { positive, opportunities: positiveOpportunities, rate: rate(positive, positiveOpportunities) },
    negativeTransferRate: { negative, opportunities: negativeOpportunities, rate: rate(negative, negativeOpportunities) },
    staleKnowledgeUsageRate: { staleUsed, opportunities: staleOpportunities, rate: rate(staleUsed, staleOpportunities) },
    staleKnowledgeRecognitionRate: { recognized: staleRecognized, citedStale, rate: rate(staleRecognized, citedStale) },
    memoryHarmRate: { harmful, comparable, rate: rate(harmful, comparable) },
    explorationReduction,
    learningCurveSlope,
  };
}
