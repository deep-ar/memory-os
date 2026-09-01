import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHardDeleteEvidence, type HardDeleteRecord } from "../src/modules/sensitive-data/index.js";

describe("hard-delete sensitive Evidence", () => {
  it("passes only a digest and administrative metadata to the audit store", async () => {
    let stored: HardDeleteRecord | undefined;
    const hardDelete = createHardDeleteEvidence({
      store: { hardDeleteEvidence: async (record) => { stored = record; return true; } },
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "audit-1" },
      hash: { sha256: (value) => createHash("sha256").update(value).digest("hex") },
    });
    const result = await hardDelete({
      projectId: "project-1", evidenceId: "evidence-containing-secret",
      reason: "credential", actor: "operator",
    });

    expect(result.ok).toBe(true);
    expect(stored?.entityIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain("evidence-containing-secret");
  });
});
