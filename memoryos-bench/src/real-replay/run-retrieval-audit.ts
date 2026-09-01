import type { DatasetDescriptor } from "../domain/run-context.js";
import type { RealReplayBundle } from "./model.js";
import type { RealReplayMemoryProvider } from "./memory-provider.js";

export interface RealReplayRetrievalAuditReport {
  readonly schemaVersion: 1;
  readonly benchmark: "MemoryOS-Bench";
  readonly track: "REAL_SESSION_RETRIEVAL_AUDIT";
  readonly dataset: { readonly id: string; readonly version: string; readonly source: string; readonly sha256: string };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "completed" | "failed";
  readonly memoryPreparation: Awaited<ReturnType<RealReplayMemoryProvider["prepare"]>> | null;
  readonly observations: readonly {
    readonly checkpointId: string;
    readonly sourceTurnIndex: number;
    readonly retrievalTimeMs: number;
    readonly retrieved: readonly { readonly id: string; readonly text: string; readonly stale: boolean }[];
    readonly error?: string;
  }[];
  readonly limitations: readonly string[];
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export async function runRealReplayRetrievalAudit(input: {
  readonly bundle: RealReplayBundle;
  readonly descriptor: DatasetDescriptor;
  readonly memoryProvider: RealReplayMemoryProvider;
}): Promise<RealReplayRetrievalAuditReport> {
  const startedAt = new Date().toISOString();
  let memoryPreparation: Awaited<ReturnType<RealReplayMemoryProvider["prepare"]>> | null = null;
  const observations: RealReplayRetrievalAuditReport["observations"][number][] = [];
  try {
    memoryPreparation = await input.memoryProvider.prepare();
  } catch (error) {
    return {
      schemaVersion: 1,
      benchmark: "MemoryOS-Bench",
      track: "REAL_SESSION_RETRIEVAL_AUDIT",
      dataset: { id: input.bundle.id, version: input.bundle.version, ...input.descriptor },
      startedAt,
      completedAt: new Date().toISOString(),
      status: "failed",
      memoryPreparation: null,
      observations,
      limitations: [`Memory preparation failed: ${message(error)}`],
    };
  }
  for (const checkpoint of input.bundle.evaluation.checkpoints) {
    try {
      const context = await input.memoryProvider.contextFor(checkpoint);
      observations.push({
        checkpointId: checkpoint.id,
        sourceTurnIndex: checkpoint.source_turn_index,
        retrievalTimeMs: context.retrievalTimeMs,
        retrieved: context.items.map((item) => ({ id: item.id, text: item.text, stale: item.stale })),
      });
    } catch (error) {
      observations.push({ checkpointId: checkpoint.id, sourceTurnIndex: checkpoint.source_turn_index, retrievalTimeMs: 0, retrieved: [], error: message(error) });
    }
  }
  return {
    schemaVersion: 1,
    benchmark: "MemoryOS-Bench",
    track: "REAL_SESSION_RETRIEVAL_AUDIT",
    dataset: { id: input.bundle.id, version: input.bundle.version, ...input.descriptor },
    startedAt,
    completedAt: new Date().toISOString(),
    status: observations.every((observation) => observation.error === undefined) ? "completed" : "failed",
    memoryPreparation,
    observations,
    limitations: [
      "This local audit records retrieved context but does not score semantic relevance without approved gold memory ids.",
      "No checkpoint content is sent to an external agent by this command.",
    ],
  };
}
