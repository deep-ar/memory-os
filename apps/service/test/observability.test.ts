import { describe, expect, it } from "vitest";
import { LocalMetricsRegistry } from "../src/adapters/metrics/local-metrics-registry.js";
import type { MemoryToolService } from "../src/modules/memory-tools/index.js";
import { instrumentMemoryTools } from "../src/modules/observability/index.js";

describe("MemoryOS operation metrics", () => {
  it("records stable operation names, outcomes, and cumulative durations", async () => {
    const raw = {
      search: async () => ({ projectRevision: 1 }),
      getContext: async () => ({}), findConcepts: async () => ({}), getClaim: async () => null,
      explainClaim: async () => null, findConflicts: async () => ({}), history: async () => ({}),
      applyDelta: async () => ({ ok: false, error: { code: "MEMORY_CONFLICT" } }),
    } as unknown as MemoryToolService;
    const metrics = new LocalMetricsRegistry();
    const instants = [0, 5, 10, 17];
    const traces: unknown[] = [];
    const tools = instrumentMemoryTools({
      tools: raw, metrics, monotonicClock: { now: () => instants.shift()! },
      traces: { recordTrace: (trace) => traces.push(trace) },
    });

    await tools.search({ projectId: "p", query: "q" });
    await tools.applyDelta({
      projectId: "p",
      delta: { reflection: { agentId: "codex", sessionId: "session-1" } },
    } as never);

    expect(metrics.operationMetrics()).toEqual([
      { operation: "memory.apply_delta", outcome: "conflict", count: 1, durationMilliseconds: 7 },
      { operation: "memory.search", outcome: "success", count: 1, durationMilliseconds: 5 },
    ]);
    expect(traces).toEqual([{
      operation: "memory.apply_delta", outcome: "conflict", projectId: "p",
      agentId: "codex", sessionId: "session-1", reflectionEventId: null,
      failureReason: "MEMORY_CONFLICT",
    }]);
  });

  it("renders Prometheus counters and primary-data gauges", () => {
    const metrics = new LocalMetricsRegistry();
    metrics.recordOperation("memory.search", "success", 12);
    const output = metrics.renderPrometheus({
      status: "healthy", checkedAt: "2026-08-30T00:00:00.000Z",
      expectedSchemaVersion: 1, actualSchemaVersion: 1, issues: [],
      counts: { projects: 2, concepts: 3, claims: 4, evidence: 5, contexts: 1, reflectionEvents: 6 },
    });
    expect(output).toContain('memoryos_operation_total{operation="memory.search",outcome="success"} 1');
    expect(output).toContain("memoryos_integrity_healthy 1");
    expect(output).toContain("memoryos_claims 4");
  });
});
