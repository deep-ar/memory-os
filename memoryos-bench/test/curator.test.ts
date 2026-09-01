import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CuratorAgent, CuratorAgentRequest } from "../src/curator/agent.js";
import { createCuratorRequest } from "../src/curator/agent.js";
import { parseCuratorDataset } from "../src/curator/dataset.js";
import { loadCuratorDataset } from "../src/curator/load-curator-dataset.js";
import { ReplayCuratorAgent } from "../src/curator/replay-agent.js";
import { runCuratorBenchmark } from "../src/curator/run-curator-benchmark.js";

const datasetPath = resolve("datasets/curator-controlled-v0.1.json");

describe("formal curator harness", () => {
  it("keeps gold output and evaluation annotations out of the agent request", async () => {
    const { dataset } = await loadCuratorDataset(datasetPath);
    const request = createCuratorRequest({ dataset, episode: dataset.episodes[0]! });
    const serialized = JSON.stringify(request);

    expect(serialized).not.toContain("gold_output");
    expect(serialized).not.toContain("promotion_expected_claim_ids");
    expect(request.episode.prior_memory.revision).toBe(0);
    expect(request.promptVersion).toBe("curator-prompt-v0.1");
  });

  it("rejects a gold claim that links undeclared evidence", async () => {
    const { dataset } = await loadCuratorDataset(datasetPath);
    const invalid = structuredClone(dataset);
    invalid.episodes[0]!.gold_output.memory_delta.claims[0]!.evidence_ids = ["missing-evidence"];

    expect(() => parseCuratorDataset(invalid)).toThrow(/unknown evidence/u);
  });

  it("scores the oracle calibration replay as formally perfect", async () => {
    const loaded = await loadCuratorDataset(datasetPath);
    const agent = await ReplayCuratorAgent.load(resolve("replays/curator-oracle-v0.1.json"));
    const report = await runCuratorBenchmark({ ...loaded, agent });

    expect(report.status).toBe("completed");
    expect(report.memoryBackendUsed).toBe(false);
    expect(report.executionKind).toBe("calibration_replay");
    expect(report.summary.admissionF1).toBe(1);
    expect(report.summary.claimTripleF1).toBe(1);
    expect(report.summary.epistemicBasisAccuracy).toBe(1);
    expect(report.summary.confidenceTransitionAccuracy).toBe(1);
    expect(report.summary.contextLinkF1).toBe(1);
    expect(report.summary.conflictRelationF1).toBe(1);
    expect(report.summary.overGeneralizationRate).toBe(0);
    expect(report.summary.falseGeneralizationRate).toBe(0);
  });

  it("refuses replay data captured for another prompt version", async () => {
    const { dataset } = await loadCuratorDataset(datasetPath);
    const agent = await ReplayCuratorAgent.load(resolve("replays/curator-oracle-v0.1.json"));
    const request = createCuratorRequest({ dataset, episode: dataset.episodes[0]! });

    await expect(agent.invoke({ ...request, promptVersion: "changed-prompt" })).rejects.toThrow(/Replay is incompatible/u);
  });

  it("detects false durable knowledge, bad labels, missing scope and false promotion", async () => {
    const loaded = await loadCuratorDataset(datasetPath);
    const agent = await ReplayCuratorAgent.load(resolve("replays/curator-faulty-v0.1.json"));
    const report = await runCuratorBenchmark({ ...loaded, agent });

    expect(report.status).toBe("completed");
    expect(report.summary.admissionPrecision).toBeLessThan(1);
    expect(report.summary.weightedAdmissionPrecision).toBeLessThan(report.summary.admissionPrecision as number);
    expect(report.summary.epistemicBasisAccuracy).toBeLessThan(1);
    expect(report.summary.confidenceTransitionAccuracy).toBe(0);
    expect(report.summary.conflictRelationF1).toBe(0);
    expect(report.summary.overGeneralizationRate).toBe(1);
    expect(report.summary.promotionPrecision).toBe(0);
    expect(report.summary.falseGeneralizationRate).toBe(1);
  });

  it("records invalid agent JSON as a failed episode", async () => {
    const loaded = await loadCuratorDataset(datasetPath);
    const invalidAgent: CuratorAgent = {
      describe: () => ({ provider: "test", model: "invalid", version: "1", reasoningMode: null, adapter: "fake" }),
      invoke: async (_request: CuratorAgentRequest) => ({
        rawOutput: "not json",
        cost: { inputTokens: null, outputTokens: null, cachedTokens: null, toolCalls: null, wallTimeMs: 1, apiCost: null },
      }),
      close: async () => {},
    };
    const report = await runCuratorBenchmark({ ...loaded, agent: invalidAgent });

    expect(report.status).toBe("failed");
    expect(report.episodes).toHaveLength(3);
    expect(report.summary.failed).toBe(3);
    expect(report.episodes[0]?.rawOutput).toBe("not json");
  });
});
