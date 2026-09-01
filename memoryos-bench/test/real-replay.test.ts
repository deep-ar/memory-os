import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexSession } from "../src/adapters/codex-session-reader.js";
import type { IntegratedAgent, IntegratedAgentRequest } from "../src/integrated/agent.js";
import { parseRealReplayBundle, parseRealReplayCheckpointSpec, type CodexSessionTranscript } from "../src/real-replay/model.js";
import type { RealReplayMemoryProvider } from "../src/real-replay/memory-provider.js";
import { prepareRealReplayBundle } from "../src/real-replay/prepare-real-replay.js";
import { runRealReplay } from "../src/real-replay/run-real-replay.js";

const rootFixture = resolve("test/fixtures/codex-root-session.jsonl");

function transcript(options: {
  readonly id: string;
  readonly startedAt: string;
  readonly turns: CodexSessionTranscript["turns"];
}): CodexSessionTranscript {
  return {
    metadata: {
      session_id: options.id,
      source_path: `${options.id}.jsonl`,
      started_at: options.startedAt,
      observed_size_bytes: 1,
      observed_sha256: "a".repeat(64),
      branch: "localization",
      commit: "abc123",
      completed_turns: options.turns.length,
      aborted_turns: 0,
      last_completed_at: options.turns.at(-1)?.completed_at ?? null,
      source_kind: "root",
    },
    turns: options.turns,
  };
}

function spec() {
  return parseRealReplayCheckpointSpec({
    schema_version: 1,
    id: "real-replay-test",
    version: "0.1.0",
    title: "Real replay test",
    project_id: "real-replay-project",
    holdout_session_id: "holdout-session",
    gold_status: "draft_agent_derived",
    repetitions: 1,
    checkpoints: [{
      id: "checkpoint-1",
      source_turn_index: 1,
      decision_options: ["wrong", "right"],
      expected_decision: "right",
      gold_basis: "A later deterministic check established the answer.",
    }],
  });
}

describe("real Codex-session replay", () => {
  it("reads only completed user turns and records aborted turns", async () => {
    const result = await readCodexSession(rootFixture);
    expect(result.metadata.source_kind).toBe("root");
    expect(result.metadata.completed_turns).toBe(1);
    expect(result.metadata.aborted_turns).toBe(1);
    expect(result.turns[0]?.user_message).toContain("build policy");
    expect(result.turns[0]?.assistant_message).toContain("verified source-build policy");
  });

  it("enforces the temporal cutoff, redacts secrets and keeps holdout outside memory", () => {
    const train = transcript({
      id: "train-session",
      startedAt: "2026-08-01T00:00:00.000Z",
      turns: [
        { index: 1, user_message: "How should deployment authentication work?", assistant_message: `Use a bounded token. api_key=super-secret ${"evidence ".repeat(12)}`, completed_at: "2026-08-01T01:00:00.000Z" },
        { index: 2, user_message: "Future task after holdout start", assistant_message: `This must not leak. ${"future ".repeat(12)}`, completed_at: "2026-08-02T01:00:00.000Z" },
      ],
    });
    const holdout = transcript({
      id: "holdout-session",
      startedAt: "2026-08-02T00:00:00.000Z",
      turns: [{ index: 1, user_message: "Choose the right policy", assistant_message: "The verified decision is right.", completed_at: "2026-08-02T02:00:00.000Z" }],
    });
    const bundle = prepareRealReplayBundle({ sessions: [train, holdout], checkpointSpec: spec(), excludedSubagentSessions: 3 });
    expect(bundle.split.train_sessions.map((session) => session.session_id)).toEqual(["train-session"]);
    expect(bundle.split.excluded_train_turns_at_or_after_cutoff).toBe(1);
    expect(bundle.split.excluded_subagent_sessions).toBe(3);
    expect(bundle.memory.cards).toBe(1);
    expect(bundle.memory.redactions).toBe(1);
    expect(JSON.stringify(bundle.memory)).not.toContain("super-secret");
    expect(JSON.stringify(bundle.memory)).not.toContain("This must not leak");

    const leaked = structuredClone(bundle);
    leaked.memory.deltas[0]!.memory_delta.claims[0]!.valid_from = holdout.metadata.started_at;
    expect(() => parseRealReplayBundle(leaked)).toThrow(/precede the holdout cutoff/u);
  });

  it("measures paired improvement without using infrastructure in policy tests", async () => {
    const train = transcript({
      id: "train-session",
      startedAt: "2026-08-01T00:00:00.000Z",
      turns: [{ index: 1, user_message: "A sufficiently detailed earlier engineering question", assistant_message: `A sufficiently detailed verified engineering conclusion. ${"evidence ".repeat(10)}`, completed_at: "2026-08-01T01:00:00.000Z" }],
    });
    const holdout = transcript({
      id: "holdout-session",
      startedAt: "2026-08-02T00:00:00.000Z",
      turns: [{ index: 1, user_message: "Choose the right policy", assistant_message: "The verified decision is right.", completed_at: "2026-08-02T02:00:00.000Z" }],
    });
    const bundle = prepareRealReplayBundle({ sessions: [train, holdout], checkpointSpec: spec() });
    const agent: IntegratedAgent = {
      describe: () => ({ provider: "test", model: "fake", version: "1", reasoningMode: null, adapter: "fake", telemetrySource: "test_fake" }),
      invoke: async (request: IntegratedAgentRequest) => ({
        rawOutput: JSON.stringify({
          decision: request.mode === "full_memory_os" ? "right" : "wrong",
          changes: [],
          trace: [{ type: "agent_step", name: "choose", known_failure_id: null }],
          memory_citations: request.mode === "full_memory_os" ? [{ memory_id: "memory-1", influence: "helpful", stale: false }] : [],
          cost: { input_tokens: 10, output_tokens: 2, cached_tokens: 0, api_cost: null, local_compute_time_ms: null },
        }),
        wallTimeMs: 5,
      }),
      close: async () => {},
    };
    const provider: RealReplayMemoryProvider = {
      prepare: async () => ({ projectId: bundle.project.id, durationMs: 1, deltas: 1, claims: 1, evidence: 1 }),
      contextFor: async () => ({ items: [{ id: "memory-1", text: "Choose right.", source_project_id: bundle.project.id, kind: "claim", stale: false }], source: "memoryos_real_session_projection", retrievalTimeMs: 2, preparationTimeMs: 0 }),
      close: async () => {},
    };
    const report = await runRealReplay({ bundle, descriptor: { source: "fixture", sha256: "b".repeat(64) }, agent, memoryProvider: provider });
    expect(report.status).toBe("exploratory_completed");
    expect(report.metrics.modes.no_memory.decisionAccuracy).toBe(0);
    expect(report.metrics.modes.full_memory_os.decisionAccuracy).toBe(1);
    expect(report.metrics.paired.improved).toBe(1);
    expect(report.metrics.memoryNetGain).toBe(1);
  });
});
