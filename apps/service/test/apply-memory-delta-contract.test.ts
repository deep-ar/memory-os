import { describe, expect, it } from "vitest";
import { parseApplyMemoryDeltaInput } from "../src/transports/contracts/apply-memory-delta.js";

describe("apply MemoryDelta transport contract", () => {
  it("normalizes the snake_case agent contract into domain input", () => {
    const command = parseApplyMemoryDeltaInput({
      project_id: "memoryos",
      memory_delta: {
        expected_revision: 0,
        reflection: {
          trigger: "manual",
        },
        concepts: [
          {
            id: "concept-1",
            project_id: "memoryos",
            canonical_name: "Claim",
            concept_type: "Mechanism",
          },
        ],
      },
    });

    expect(command.projectId).toBe("memoryos");
    expect(command.delta.reflection.agentId).toBeNull();
    expect(command.delta.concepts[0]).toMatchObject({
      id: "concept-1",
      projectId: "memoryos",
      canonicalName: "Claim",
      description: null,
      aliases: [],
    });
  });

  it("rejects an empty delta", () => {
    expect(() =>
      parseApplyMemoryDeltaInput({
        project_id: "memoryos",
        memory_delta: {
          expected_revision: 0,
          reflection: { trigger: "manual" },
        },
      }),
    ).toThrow(/at least one operation/u);
  });

  it("normalizes offset timestamps to UTC before persistence", () => {
    const command = parseApplyMemoryDeltaInput({
      project_id: "memoryos",
      memory_delta: {
        expected_revision: 0,
        reflection: { trigger: "manual" },
        concepts: [{
          id: "concept-time",
          project_id: "memoryos",
          canonical_name: "UTC time",
          concept_type: "Mechanism",
        }],
        claims: [{
          id: "claim-time",
          project_id: "memoryos",
          subject_id: "concept-time",
          predicate: "USES",
          statement: "Temporal comparisons use normalized instants",
          epistemic_basis: "decision",
          confidence_level: "established",
          lifecycle_status: "active",
          valid_from: "2026-08-30T15:00:00+03:00",
        }],
      },
    });

    expect(command.delta.claims[0]?.validFrom).toBe("2026-08-30T12:00:00.000Z");
  });
});
