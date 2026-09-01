import { z } from "zod";
import type { JsonValue } from "../domain/json.js";
import type { DatasetDescriptor } from "../domain/run-context.js";

const DatasetIdentitySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  source: z.string().min(1),
  sha256: z.string().min(1),
}).passthrough();

const KernelReportSchema = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.literal("MemoryOS-Bench"),
  profile: z.string().min(1),
  dataset: DatasetIdentitySchema,
  backend: z.record(z.string(), z.unknown()),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  summary: z.record(z.string(), z.unknown()),
}).passthrough();

const CuratorReportSchema = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.literal("MemoryOS-Bench"),
  track: z.literal("CURATOR"),
  profile: z.string().min(1),
  dataset: DatasetIdentitySchema,
  agent: z.record(z.string(), z.unknown()),
  executionKind: z.enum(["calibration_replay", "external_agent", "test_fake"]),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  summary: z.record(z.string(), z.unknown()),
  capabilityGaps: z.array(z.string()),
}).passthrough();

const IntegratedReportSchema = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.literal("MemoryOS-Bench"),
  track: z.literal("INTEGRATED"),
  profile: z.string().min(1),
  dataset: DatasetIdentitySchema,
  agent: z.record(z.string(), z.unknown()),
  executionKind: z.enum(["calibration_replay", "external_agent", "test_fake"]),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  runs: z.array(z.object({
    memory: z.object({ source: z.string().min(1) }).passthrough(),
  }).passthrough()),
  metrics: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string()),
}).passthrough();

export type KernelReportInput = z.infer<typeof KernelReportSchema>;
export type CuratorReportInput = z.infer<typeof CuratorReportSchema>;
export type IntegratedReportInput = z.infer<typeof IntegratedReportSchema>;

export interface LoadedReport<T> {
  readonly report: T;
  readonly descriptor: DatasetDescriptor;
}

export interface CombinedTrackSection {
  readonly profile: string;
  readonly status: "completed" | "failed";
  readonly evidenceLevel: "live_system_measurement" | "external_agent_measurement" | "evaluator_calibration" | "test_only";
  readonly dataset: Readonly<Record<string, JsonValue>>;
  readonly sourceReport: DatasetDescriptor;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly summary: Readonly<Record<string, JsonValue>>;
}

export interface CombinedBenchmarkReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly reportKind: "canonical_combined";
  readonly generatedAt: string;
  readonly status: "completed" | "failed";
  readonly sections: {
    readonly kernel: CombinedTrackSection & { readonly backend: Readonly<Record<string, JsonValue>> };
    readonly curator: CombinedTrackSection & {
      readonly executionKind: CuratorReportInput["executionKind"];
      readonly agent: Readonly<Record<string, JsonValue>>;
      readonly capabilityGaps: readonly string[];
    };
    readonly integrated: CombinedTrackSection & {
      readonly executionKind: IntegratedReportInput["executionKind"];
      readonly agent: Readonly<Record<string, JsonValue>>;
      readonly memoryContextSources: readonly string[];
      readonly limitations: readonly string[];
    };
  };
  readonly warnings: readonly string[];
}

function jsonRecord(value: Record<string, unknown>): Readonly<Record<string, JsonValue>> {
  return value as Readonly<Record<string, JsonValue>>;
}

function datasetIdentity(value: z.infer<typeof DatasetIdentitySchema>): Readonly<Record<string, JsonValue>> {
  return { id: value.id, version: value.version, source: value.source, sha256: value.sha256 };
}

function evidenceLevel(executionKind: CuratorReportInput["executionKind"] | IntegratedReportInput["executionKind"]): CombinedTrackSection["evidenceLevel"] {
  if (executionKind === "calibration_replay") return "evaluator_calibration";
  if (executionKind === "external_agent") return "external_agent_measurement";
  return "test_only";
}

export function parseKernelReport(input: unknown): KernelReportInput { return KernelReportSchema.parse(input); }
export function parseCuratorReport(input: unknown): CuratorReportInput { return CuratorReportSchema.parse(input); }
export function parseIntegratedReport(input: unknown): IntegratedReportInput { return IntegratedReportSchema.parse(input); }

export function composeCombinedReport(input: {
  readonly kernel: LoadedReport<KernelReportInput>;
  readonly curator: LoadedReport<CuratorReportInput>;
  readonly integrated: LoadedReport<IntegratedReportInput>;
  readonly generatedAt?: string;
}): CombinedBenchmarkReport {
  const memoryContextSources = [...new Set(input.integrated.report.runs.map((run) => run.memory.source))].sort();
  const warnings: string[] = [];
  if (input.curator.report.executionKind === "calibration_replay") {
    warnings.push("CURATOR is evaluator calibration from replay data, not a live-agent quality measurement.");
  }
  if (input.integrated.report.executionKind === "calibration_replay") {
    warnings.push("INTEGRATED is evaluator calibration from replay data, not a live-agent quality measurement.");
  }
  if (!memoryContextSources.some((source) => source.startsWith("memoryos_"))) {
    warnings.push("INTEGRATED did not use a live MemoryOS context provider; Full Memory OS values are not end-to-end product evidence.");
  }
  if (!memoryContextSources.includes("flat_rag")) {
    warnings.push("INTEGRATED did not use a live Flat RAG provider; Flat RAG values are fixture-based.");
  }
  const statuses = [input.kernel.report.status, input.curator.report.status, input.integrated.report.status];

  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    reportKind: "canonical_combined",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: statuses.every((status) => status === "completed") ? "completed" : "failed",
    sections: {
      kernel: {
        profile: input.kernel.report.profile,
        status: input.kernel.report.status,
        evidenceLevel: "live_system_measurement",
        dataset: datasetIdentity(input.kernel.report.dataset),
        sourceReport: input.kernel.descriptor,
        startedAt: input.kernel.report.startedAt,
        completedAt: input.kernel.report.completedAt,
        summary: jsonRecord(input.kernel.report.summary),
        backend: jsonRecord(input.kernel.report.backend),
      },
      curator: {
        profile: input.curator.report.profile,
        status: input.curator.report.status,
        evidenceLevel: evidenceLevel(input.curator.report.executionKind),
        dataset: datasetIdentity(input.curator.report.dataset),
        sourceReport: input.curator.descriptor,
        startedAt: input.curator.report.startedAt,
        completedAt: input.curator.report.completedAt,
        summary: jsonRecord(input.curator.report.summary),
        executionKind: input.curator.report.executionKind,
        agent: jsonRecord(input.curator.report.agent),
        capabilityGaps: input.curator.report.capabilityGaps,
      },
      integrated: {
        profile: input.integrated.report.profile,
        status: input.integrated.report.status,
        evidenceLevel: evidenceLevel(input.integrated.report.executionKind),
        dataset: datasetIdentity(input.integrated.report.dataset),
        sourceReport: input.integrated.descriptor,
        startedAt: input.integrated.report.startedAt,
        completedAt: input.integrated.report.completedAt,
        summary: jsonRecord(input.integrated.report.metrics),
        executionKind: input.integrated.report.executionKind,
        agent: jsonRecord(input.integrated.report.agent),
        memoryContextSources,
        limitations: input.integrated.report.limitations,
      },
    },
    warnings,
  };
}
