import type { IntegratedMemoryContext } from "../integrated/agent.js";
import type { RealReplayCheckpoint } from "./model.js";

export interface RealReplayMemoryPreparation {
  readonly projectId: string;
  readonly durationMs: number;
  readonly deltas: number;
  readonly claims: number;
  readonly evidence: number;
}

export interface RealReplayMemoryProvider {
  prepare(): Promise<RealReplayMemoryPreparation>;
  contextFor(checkpoint: RealReplayCheckpoint): Promise<IntegratedMemoryContext>;
  close(): Promise<void>;
}
