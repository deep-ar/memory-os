import { createHash } from "node:crypto";
import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";
import { FalkorDbSensitiveDataStore } from "../src/adapters/memory/falkordb-sensitive-data-store.js";
import { createHardDeleteEvidence } from "../src/modules/sensitive-data/index.js";

const url = process.env.FALKORDB_INTEGRATION_URL;
const integration = url === undefined ? describe.skip : describe;
const graphName = `memoryos_hard_delete_${process.pid}_${Date.now()}`;

integration("FalkorDB sensitive-data hard delete", () => {
  let memory: FalkorDbMemoryStore;
  let sensitiveData: FalkorDbSensitiveDataStore;
  let inspector: FalkorDB;

  beforeAll(async () => {
    memory = await FalkorDbMemoryStore.connect({ url: url!, graphName });
    sensitiveData = await FalkorDbSensitiveDataStore.connect({ url: url!, graphName });
    inspector = await FalkorDB.connect({ url: url! });
    await memory.bootstrap({ embeddingDimension: 3 });
  });

  afterAll(async () => {
    await memory.close();
    await sensitiveData.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.close();
  });

  it("removes content and relationships while retaining a content-free audit tombstone", async () => {
    const graph = inspector.selectGraph(graphName);
    await graph.query(
      `CREATE (project:Project {id: 'p', name: 'Project', revision: 0, schemaVersion: 1})
       CREATE (evidence:Evidence {id: 'sensitive-evidence', projectId: 'p',
         summary: 'password=production-value', content: 'private payload', schemaVersion: 1})
       CREATE (project)-[:HAS_EVIDENCE]->(evidence)`,
    );
    const hardDelete = createHardDeleteEvidence({
      store: sensitiveData,
      clock: { now: () => "2026-08-30T12:00:00.000Z" },
      ids: { nextId: () => "audit-1" },
      hash: { sha256: (value) => createHash("sha256").update(value).digest("hex") },
    });

    await expect(hardDelete({
      projectId: "p", evidenceId: "sensitive-evidence", reason: "credential", actor: "operator",
    })).resolves.toEqual({ ok: true, auditId: "audit-1", deletedAt: "2026-08-30T12:00:00.000Z" });

    const result = await graph.roQuery<{
      readonly evidenceCount: number;
      readonly auditJson: string;
    }>(
      `MATCH (audit:HardDeleteAudit {id: 'audit-1'})
       OPTIONAL MATCH (evidence:Evidence {projectId: 'p'})
       RETURN count(evidence) AS evidenceCount, toJson(audit) AS auditJson`,
    );
    expect(result.data?.[0]?.evidenceCount).toBe(0);
    expect(result.data?.[0]?.auditJson).not.toContain("private payload");
    expect(result.data?.[0]?.auditJson).not.toContain("production-value");
    expect(result.data?.[0]?.auditJson).not.toContain("sensitive-evidence");
  });
});
