import { describe, expect, it } from "vitest";
import type { EntityIdentity } from "../src/domain/dataset.js";
import { computeProbeMetrics } from "../src/kernel/metrics.js";

const identity = (entity_type: EntityIdentity["entity_type"], entity_id: string, relevance?: number): EntityIdentity => ({
  entity_type,
  entity_id,
  ...(relevance === undefined ? {} : { relevance }),
});

describe("computeProbeMetrics", () => {
  it("computes typed recall, reciprocal rank and graded nDCG", () => {
    const metrics = computeProbeMetrics(
      [identity("evidence", "noise"), identity("claim", "answer"), identity("concept", "topic")],
      [identity("claim", "answer", 3), identity("concept", "topic", 1)],
      [],
    );

    expect(metrics.recallAt1).toBe(0);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.meanReciprocalRank).toBe(0.5);
    expect(metrics.ndcgAt10).toBeGreaterThan(0.6);
    expect(metrics.ndcgAt10).toBeLessThan(1);
  });

  it("does not confuse equal ids of different entity types and reports leaks", () => {
    const metrics = computeProbeMetrics(
      [identity("concept", "same"), identity("claim", "same"), identity("claim", "same")],
      [identity("claim", "same")],
      [identity("concept", "same")],
    );

    expect(metrics.meanReciprocalRank).toBe(0.5);
    expect(metrics.leakedForbidden).toEqual([identity("concept", "same")]);
  });
});
