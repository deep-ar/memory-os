import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../src/modules/retrieval/index.js";

const claim = (entityId: string) => ({ entityId, entityType: "claim" as const });

describe("reciprocalRankFusion", () => {
  it("promotes results independently found through multiple channels", () => {
    const result = reciprocalRankFusion(
      [
        { channel: "semantic", results: [claim("semantic-only"), claim("shared")] },
        { channel: "full_text", results: [claim("shared"), claim("text-only")] },
        { channel: "graph", results: [claim("shared")] },
      ],
      { k: 60, maxResults: 10 },
    );

    expect(result[0]).toMatchObject({
      entityId: "shared",
      channelRanks: { semantic: 2, full_text: 1, graph: 1 },
    });
  });

  it("deduplicates repeated references within one channel", () => {
    const result = reciprocalRankFusion(
      [{ channel: "semantic", results: [claim("a"), claim("a")] }],
      { k: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeCloseTo(1 / 11);
  });

  it("uses a stable reference-key tiebreaker", () => {
    const result = reciprocalRankFusion([
      { channel: "semantic", results: [claim("b")] },
      { channel: "full_text", results: [claim("a")] },
    ]);

    expect(result.map((item) => item.entityId)).toEqual(["a", "b"]);
  });
});

