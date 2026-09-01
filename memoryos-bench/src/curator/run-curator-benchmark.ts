import type { BenchmarkClock, DatasetDescriptor } from "../domain/run-context.js";
import type { AgentCost, CuratorAgent, CuratorAgentDescriptor } from "./agent.js";
import { createCuratorRequest } from "./agent.js";
import { parseCuratorOutput, type CuratorDataset, type CuratorOutput } from "./dataset.js";
import { scoreCuratorOutput, type CuratorMetrics } from "./metrics.js";

export interface CuratorEpisodeReport {
  readonly id: string;
  readonly projectId: string;
  readonly phase: string;
  readonly status: "completed" | "failed";
  readonly rawOutput: string | null;
  readonly parsedOutput: CuratorOutput | null;
  readonly metrics: CuratorMetrics | null;
  readonly cost: AgentCost | null;
  readonly error?: string;
}

export interface CuratorReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly track: "CURATOR";
  readonly profile: CuratorDataset["profile"];
  readonly dataset: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
    readonly sha256: string;
  };
  readonly agent: CuratorAgentDescriptor;
  readonly executionKind: "calibration_replay" | "external_agent" | "test_fake";
  readonly promptVersion: string;
  readonly memorySkillVersion: string;
  readonly memoryBackendUsed: false;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "completed" | "failed";
  readonly episodes: readonly CuratorEpisodeReport[];
  readonly summary: CuratorSummary;
  readonly capabilityGaps: readonly string[];
}

export interface CuratorSummary {
  readonly attempted: number;
  readonly completed: number;
  readonly failed: number;
  readonly admissionPrecision: number | null;
  readonly admissionRecall: number | null;
  readonly admissionF1: number | null;
  readonly weightedAdmissionPrecision: number | null;
  readonly conceptF1: number | null;
  readonly duplicateConceptRate: number | null;
  readonly claimTripleF1: number | null;
  readonly epistemicBasisAccuracy: number | null;
  readonly confidenceTransitionAccuracy: number | null;
  readonly evidenceLinkF1: number | null;
  readonly evidenceF1: number | null;
  readonly contextF1: number | null;
  readonly contextLinkF1: number | null;
  readonly overGeneralizationRate: number | null;
  readonly temporalClassificationAccuracy: number | null;
  readonly validRangeAccuracy: number | null;
  readonly conflictRelationF1: number | null;
  readonly promotionPrecision: number | null;
  readonly promotionRecall: number | null;
  readonly falseGeneralizationRate: number | null;
  readonly totalInputTokens: number | null;
  readonly totalOutputTokens: number | null;
  readonly totalWallTimeMs: number;
  readonly aggregation: "macro_episode_mean";
}

const systemClock: BenchmarkClock = {
  instant: () => new Date().toISOString(),
  monotonicMilliseconds: () => performance.now(),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function average(values: readonly (number | null)[]): number | null {
  const applicable = values.filter((value): value is number => value !== null);
  return applicable.length === 0 ? null : applicable.reduce((sum, value) => sum + value, 0) / applicable.length;
}

function summary(episodes: readonly CuratorEpisodeReport[]): CuratorSummary {
  const successful = episodes.filter((episode): episode is CuratorEpisodeReport & { metrics: CuratorMetrics; cost: AgentCost } => episode.metrics !== null && episode.cost !== null);
  const metrics = successful.map((episode) => episode.metrics);
  return {
    attempted: episodes.length,
    completed: successful.length,
    failed: episodes.length - successful.length,
    admissionPrecision: average(metrics.map((item) => item.admission.precision)),
    admissionRecall: average(metrics.map((item) => item.admission.recall)),
    admissionF1: average(metrics.map((item) => item.admission.f1)),
    weightedAdmissionPrecision: average(metrics.map((item) => item.admission.precisionWeightedForFalseDurability)),
    conceptF1: average(metrics.map((item) => item.concepts.f1)),
    duplicateConceptRate: average(metrics.map((item) => item.duplicateConceptRate)),
    claimTripleF1: average(metrics.map((item) => item.claimTriples.f1)),
    epistemicBasisAccuracy: average(metrics.map((item) => item.epistemicBasis.accuracy)),
    confidenceTransitionAccuracy: average(metrics.map((item) => item.confidenceTransition.accuracy)),
    evidenceLinkF1: average(metrics.map((item) => item.evidenceLinks.f1)),
    evidenceF1: average(metrics.map((item) => item.evidence.f1)),
    contextF1: average(metrics.map((item) => item.contexts.f1)),
    contextLinkF1: average(metrics.map((item) => item.contextLinks.f1)),
    overGeneralizationRate: average(metrics.map((item) => item.overGeneralization.rate)),
    temporalClassificationAccuracy: average(metrics.map((item) => item.temporalClassification.accuracy)),
    validRangeAccuracy: average(metrics.map((item) => item.validRange.accuracy)),
    conflictRelationF1: average(metrics.map((item) => item.conflictRelations.f1)),
    promotionPrecision: average(metrics.map((item) => item.promotion.precision)),
    promotionRecall: average(metrics.map((item) => item.promotion.recall)),
    falseGeneralizationRate: average(metrics.map((item) => item.promotion.falseGeneralizationRate)),
    totalInputTokens: successful.every((episode) => episode.cost.inputTokens !== null)
      ? successful.reduce((sum, episode) => sum + (episode.cost.inputTokens ?? 0), 0)
      : null,
    totalOutputTokens: successful.every((episode) => episode.cost.outputTokens !== null)
      ? successful.reduce((sum, episode) => sum + (episode.cost.outputTokens ?? 0), 0)
      : null,
    totalWallTimeMs: successful.reduce((sum, episode) => sum + episode.cost.wallTimeMs, 0),
    aggregation: "macro_episode_mean",
  };
}

export async function runCuratorBenchmark(input: {
  readonly dataset: CuratorDataset;
  readonly descriptor: DatasetDescriptor;
  readonly agent: CuratorAgent;
  readonly clock?: BenchmarkClock;
}): Promise<CuratorReport> {
  const clock = input.clock ?? systemClock;
  const startedAt = clock.instant();
  const episodeReports: CuratorEpisodeReport[] = [];
  for (const episode of input.dataset.episodes) {
    let rawOutput: string | null = null;
    try {
      const result = await input.agent.invoke(createCuratorRequest({ dataset: input.dataset, episode }));
      rawOutput = result.rawOutput;
      const parsedJson: unknown = JSON.parse(result.rawOutput);
      const parsedOutput = parseCuratorOutput(parsedJson);
      episodeReports.push({
        id: episode.id,
        projectId: episode.project_id,
        phase: episode.phase,
        status: "completed",
        rawOutput,
        parsedOutput,
        metrics: scoreCuratorOutput(episode, parsedOutput),
        cost: result.cost,
      });
    } catch (error) {
      episodeReports.push({
        id: episode.id,
        projectId: episode.project_id,
        phase: episode.phase,
        status: "failed",
        rawOutput,
        parsedOutput: null,
        metrics: null,
        cost: null,
        error: message(error),
      });
    }
  }

  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    track: "CURATOR",
    profile: input.dataset.profile,
    dataset: {
      id: input.dataset.id,
      version: input.dataset.version,
      source: input.descriptor.source,
      sha256: input.descriptor.sha256,
    },
    agent: input.agent.describe(),
    executionKind: input.agent.describe().adapter === "replay"
      ? "calibration_replay"
      : input.agent.describe().adapter === "stdio" ? "external_agent" : "test_fake",
    promptVersion: input.dataset.prompt_version,
    memorySkillVersion: input.dataset.memory_skill_version,
    memoryBackendUsed: false,
    startedAt,
    completedAt: clock.instant(),
    status: episodeReports.every((episode) => episode.status === "completed") ? "completed" : "failed",
    episodes: episodeReports,
    summary: summary(episodeReports),
    capabilityGaps: [
      "B11 cleanup mutations are not representable by create-only MemoryDelta v1.",
      "B12 source-of-truth promotion has no MemoryDelta v1 operation and is not scored.",
    ],
  };
}
