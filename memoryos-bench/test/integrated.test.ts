import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureIntegratedMemoryContextProvider, IntegratedAgentOutputSchema, createIntegratedRequest } from "../src/integrated/agent.js";
import { EXPERIMENTAL_MODES } from "../src/integrated/dataset.js";
import { loadIntegratedDataset } from "../src/integrated/load-integrated-dataset.js";
import { ReplayIntegratedAgent } from "../src/integrated/replay-agent.js";
import { regradeIntegratedReport } from "../src/integrated/regrade-integrated-report.js";
import { runIntegratedBenchmark } from "../src/integrated/run-integrated-benchmark.js";
import { StdioIntegratedAgent } from "../src/integrated/stdio-agent.js";
import { evaluateWorkspaceResult } from "../src/integrated/workspace.js";

const datasetPath = resolve("datasets/integrated-controlled-v0.1.json");
const replayPath = resolve("replays/integrated-calibration-v0.1.json");

describe("controlled integrated harness", () => {
  it("executes all five modes with three repetitions and derives diagnostic gaps", async () => {
    const loaded = await loadIntegratedDataset(datasetPath);
    const agent = await ReplayIntegratedAgent.load(replayPath);
    const report = await runIntegratedBenchmark({
      ...loaded,
      agent,
      memoryProvider: new FixtureIntegratedMemoryContextProvider(),
    });

    expect(report.status).toBe("completed");
    expect(report.executionKind).toBe("calibration_replay");
    expect(report.runs).toHaveLength(loaded.dataset.scenarios.length * EXPERIMENTAL_MODES.length * 3);
    expect(report.metrics.modes.no_memory.taskSuccessRate).toBeCloseTo(2 / 3);
    expect(report.metrics.modes.no_memory.decisionAccuracy).toBeCloseTo(2 / 3);
    expect(report.metrics.modes.oracle_memory.taskSuccessRate).toBe(1);
    expect(report.metrics.modes.oracle_writes.taskSuccessRate).toBe(1);
    expect(report.metrics.modes.full_memory_os.taskSuccessRate).toBeCloseTo(2 / 3);
    expect(report.metrics.modes.full_memory_os.memoryRetrievalTimeMs.count).toBe(9);
    expect(report.metrics.modes.full_memory_os.memoryRetrievalTimeMs.p95).toBeGreaterThanOrEqual(0);
    expect(report.metrics.gaps.potentialMemoryGain).toBeCloseTo(1 / 3);
    expect(report.metrics.gaps.retrievalGap).toBe(0);
    expect(report.metrics.gaps.curationGap).toBeCloseTo(1 / 3);
    expect(report.metrics.gaps.memoryNetGain).toBe(0);
    expect(report.metrics.memoryHarmRate.rate).toBeCloseTo(1 / 3);
    expect(report.metrics.positiveTransferRate.rate).toBeCloseTo(5 / 6);
    expect(report.metrics.negativeTransferRate.rate).toBeCloseTo(1 / 6);
    expect(report.metrics.staleKnowledgeUsageRate.rate).toBe(1);
    expect(report.metrics.staleKnowledgeRecognitionRate.rate).toBe(1);
    expect(report.metrics.repeatedMistakeRate.rate).toBeCloseTo(1 / 3);
    expect(report.metrics.explorationReduction.agentSteps).toBe(1);
    expect(report.metrics.explorationReduction.failedAttempts).toBe(1);
    expect(report.metrics.learningCurveSlope["safe-file-replacement"]).toBeLessThan(0);
  });

  it("rejects changes outside the scenario allowlist", async () => {
    const { dataset } = await loadIntegratedDataset(datasetPath);
    const output = IntegratedAgentOutputSchema.parse({
      decision: dataset.scenarios[0]!.validator.expected_decision,
      changes: [{ path: "../escape.txt", content: "bad" }],
      trace: [],
      memory_citations: [],
      cost: { input_tokens: null, output_tokens: null, cached_tokens: null, api_cost: null, local_compute_time_ms: null },
    });
    const validation = evaluateWorkspaceResult(dataset.scenarios[0]!, output);

    expect(validation.success).toBe(false);
    expect(validation.failures.join(" ")).toMatch(/outside the scenario allowlist/u);
  });

  it("compares JSON repository state structurally", async () => {
    const { dataset } = await loadIntegratedDataset(datasetPath);
    const scenario = dataset.scenarios[0]!;
    const output = IntegratedAgentOutputSchema.parse({
      decision: scenario.validator.expected_decision,
      changes: [{ path: "settings-policy.json", content: "{\n  \"save_strategy\": \"atomic_target_temp_rename\"\n}" }],
      trace: [],
      memory_citations: [],
      cost: { input_tokens: null, output_tokens: null, cached_tokens: null, api_cost: null, local_compute_time_ms: null },
    });

    expect(evaluateWorkspaceResult(scenario, output).success).toBe(true);
  });

  it("binds replay data to experiment versions", async () => {
    const { dataset } = await loadIntegratedDataset(datasetPath);
    const agent = await ReplayIntegratedAgent.load(replayPath);
    const scenario = dataset.scenarios[0]!;
    const request = createIntegratedRequest({ dataset, scenario, mode: "no_memory", repetition: 1, memory: [] });

    await expect(agent.invoke({ ...request, toolsetVersion: "changed" })).rejects.toThrow(/replay is incompatible/u);
  });

  it("does not disclose evaluator-only stale labels to the agent", async () => {
    const { dataset } = await loadIntegratedDataset(datasetPath);
    const scenario = dataset.scenarios[1]!;
    const request = createIntegratedRequest({
      dataset,
      scenario,
      mode: "full_memory_os",
      repetition: 1,
      memory: scenario.memory.full_memory_os,
    });

    expect(request.memory.some((item) => "stale" in item)).toBe(false);
  });

  it("runs one provider-neutral integrated stdio invocation", async () => {
    const { dataset } = await loadIntegratedDataset(datasetPath);
    const scenario = dataset.scenarios[0]!;
    const agent = new StdioIntegratedAgent({
      executable: process.execPath,
      args: [resolve("test/fixtures/stdio-integrated-agent.mjs")],
      provider: "test",
      model: "stdio-echo",
      version: "1",
      timeoutMs: 5_000,
    });
    const result = await agent.invoke(createIntegratedRequest({ dataset, scenario, mode: "no_memory", repetition: 1, memory: [] }));

    expect(IntegratedAgentOutputSchema.parse(JSON.parse(result.rawOutput)).decision).toBe("stdio_smoke");
    expect(result.wallTimeMs).toBeGreaterThan(0);
    expect(agent.describe().telemetrySource).toBe("agent_adapter_reported");
  });

  it("regrades stale classification as a metric instead of a protocol failure", async () => {
    const loaded = await loadIntegratedDataset(datasetPath);
    const agent = await ReplayIntegratedAgent.load(replayPath);
    const original = await runIntegratedBenchmark({
      ...loaded,
      agent,
      memoryProvider: new FixtureIntegratedMemoryContextProvider(),
    });
    const index = original.runs.findIndex((run) => run.scenario.id === "integrated-cross-mount-trap-002" && run.mode === "full_memory_os");
    const source = original.runs[index]!;
    const raw = JSON.parse(source.rawOutput!) as { memory_citations: Array<{ stale: boolean }> };
    raw.memory_citations[0]!.stale = false;
    const failed = {
      ...original,
      status: "failed" as const,
      runs: original.runs.map((run, runIndex) => runIndex === index ? {
        ...run,
        status: "failed" as const,
        rawOutput: JSON.stringify(raw),
        output: null,
        validation: null,
        cost: null,
        error: "Agent stale flag disagrees",
      } : run),
    };

    const regraded = regradeIntegratedReport({
      report: failed,
      descriptor: { source: "old-report.json", sha256: "abc" },
      reason: "stale classification is evaluator metadata",
      regradedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(regraded.status).toBe("completed");
    expect(regraded.regrade?.recoveredRuns).toBe(1);
    expect(regraded.regrade?.wallTimeMissingRuns).toBe(1);
  });
});
