import { z } from "zod";
import type { DatasetDescriptor } from "../domain/run-context.js";
import { IntegratedAgentOutputSchema } from "./agent.js";
import { validateMemoryCitations } from "./citation-contract.js";
import { calculateIntegratedMetrics, costVector, type IntegratedRunRecord } from "./metrics.js";
import type { IntegratedReport } from "./run-integrated-benchmark.js";
import { evaluateWorkspaceResult } from "./workspace.js";

const RegradeableReportSchema = z.object({
  schemaVersion: z.literal(1),
  benchmark: z.literal("MemoryOS-Bench"),
  track: z.literal("INTEGRATED"),
  runs: z.array(z.unknown()),
}).passthrough();

export function parseRegradeableIntegratedReport(input: unknown): IntegratedReport {
  return RegradeableReportSchema.parse(input) as unknown as IntegratedReport;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function regradeRun(run: IntegratedRunRecord): IntegratedRunRecord {
  if (run.rawOutput === null) return run;
  let output = run.output;
  let validation = run.validation;
  let cost = run.cost;
  try {
    output = IntegratedAgentOutputSchema.parse(JSON.parse(run.rawOutput));
    cost ??= costVector(output, null);
    validateMemoryCitations({ mode: run.mode, output, memory: run.memory });
    validation = evaluateWorkspaceResult(run.scenario, output);
    const { error: _error, ...withoutError } = run;
    return {
      ...withoutError,
      status: "completed",
      output,
      validation,
      cost,
    };
  } catch (error) {
    return {
      ...run,
      status: "failed",
      output,
      validation,
      cost,
      error: message(error),
    };
  }
}

export function regradeIntegratedReport(input: {
  readonly report: IntegratedReport;
  readonly descriptor: DatasetDescriptor;
  readonly reason: string;
  readonly regradedAt?: string;
}): IntegratedReport {
  const runs = input.report.runs.map(regradeRun);
  const recoveredRuns = runs.filter((run, index) => input.report.runs[index]?.status === "failed" && run.status === "completed").length;
  const wallTimeMissingRuns = runs.filter((run) => run.cost?.wallTimeMs === null).length;
  return {
    ...input.report,
    completedAt: input.regradedAt ?? new Date().toISOString(),
    status: runs.every((run) => run.status === "completed") ? "completed" : "failed",
    runs,
    metrics: calculateIntegratedMetrics(runs),
    limitations: [
      ...input.report.limitations,
      ...(wallTimeMissingRuns === 0 ? [] : [`Agent wall time is unavailable for ${wallTimeMissingRuns} run(s) recovered from raw output during regrade.`]),
    ],
    regrade: {
      sourceReport: input.descriptor,
      reason: input.reason,
      recoveredRuns,
      wallTimeMissingRuns,
    },
  };
}
