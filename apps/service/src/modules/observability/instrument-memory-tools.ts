import type { MemoryToolService } from "../memory-tools/index.js";
import type { OperationMetricRecorder, OperationOutcome, OperationTraceSink } from "./types.js";

export function instrumentMemoryTools(dependencies: {
  readonly tools: MemoryToolService;
  readonly metrics: OperationMetricRecorder;
  readonly monotonicClock: { now(): number };
  readonly traces?: OperationTraceSink;
}): MemoryToolService {
  async function measured<T>(
    operation: string,
    run: () => Promise<T>,
    outcome: (result: T) => OperationOutcome = () => "success",
  ): Promise<T> {
    const started = dependencies.monotonicClock.now();
    try {
      const result = await run();
      dependencies.metrics.recordOperation(
        operation, outcome(result), dependencies.monotonicClock.now() - started,
      );
      return result;
    } catch (error) {
      dependencies.metrics.recordOperation(
        operation, "failure", dependencies.monotonicClock.now() - started,
      );
      throw error;
    }
  }

  return {
    search: (input) => measured("memory.search", () => dependencies.tools.search(input)),
    getContext: (input) => measured("memory.get_context", () => dependencies.tools.getContext(input)),
    findConcepts: (input) => measured("memory.find_concepts", () => dependencies.tools.findConcepts(input)),
    getClaim: (input) => measured("memory.get_claim", () => dependencies.tools.getClaim(input)),
    explainClaim: (input) => measured("memory.explain_claim", () => dependencies.tools.explainClaim(input)),
    findConflicts: (input) => measured("memory.find_conflicts", () => dependencies.tools.findConflicts(input)),
    applyDelta: async (input) => {
      try {
        const result = await measured(
          "memory.apply_delta",
          () => dependencies.tools.applyDelta(input),
          (value) => value.ok ? "success" : value.error.code === "MEMORY_CONFLICT" ? "conflict" : "failure",
        );
        const outcome = result.ok ? "success" : result.error.code === "MEMORY_CONFLICT" ? "conflict" : "failure";
        dependencies.traces?.recordTrace({
          operation: "memory.apply_delta", outcome, projectId: input.projectId,
          agentId: input.delta.reflection.agentId, sessionId: input.delta.reflection.sessionId,
          reflectionEventId: result.ok ? result.reflectionEventId : null,
          failureReason: result.ok ? null : result.error.code,
        });
        return result;
      } catch (error) {
        dependencies.traces?.recordTrace({
          operation: "memory.apply_delta", outcome: "failure", projectId: input.projectId,
          agentId: input.delta.reflection.agentId, sessionId: input.delta.reflection.sessionId,
          reflectionEventId: null,
          failureReason: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        });
        throw error;
      }
    },
    history: (input) => measured("memory.history", () => dependencies.tools.history(input)),
  };
}
