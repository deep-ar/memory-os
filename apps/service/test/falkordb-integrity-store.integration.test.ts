import { FalkorDB } from "falkordb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalkorDbIntegrityStore } from "../src/adapters/memory/falkordb-integrity-store.js";
import { FalkorDbMemoryStore } from "../src/adapters/memory/falkordb-memory-store.js";

const url = process.env.FALKORDB_INTEGRATION_URL;
const integration = url === undefined ? describe.skip : describe;
const graphName = `memoryos_integrity_${process.pid}_${Date.now()}`;
const migrationGraphName = `${graphName}_migration`;

integration("FalkorDB integrity facts", () => {
  let integrity: FalkorDbIntegrityStore;
  let memory: FalkorDbMemoryStore;
  let inspector: FalkorDB;

  beforeAll(async () => {
    memory = await FalkorDbMemoryStore.connect({ url: url!, graphName });
    integrity = await FalkorDbIntegrityStore.connect({ url: url!, graphName });
    inspector = await FalkorDB.connect({ url: url! });
    await memory.bootstrap({ embeddingDimension: 3 });
  });

  afterAll(async () => {
    await memory.close();
    await integrity.close();
    await inspector.selectGraph(graphName).delete();
    await inspector.selectGraph(migrationGraphName).delete();
    await inspector.close();
  });

  it("reports a clean empty primary graph and detects isolated corruption", async () => {
    await expect(integrity.inspectIntegrity()).resolves.toMatchObject({
      schemaVersion: 1, orphanEntities: 0, schemaVersionViolations: 0,
      counts: { projects: 0, concepts: 0 },
    });

    await inspector.selectGraph(graphName).query(
      `CREATE (:Concept {id: 'orphan', projectId: 'missing', schemaVersion: 1})
       CREATE (:Project {id: 'bad-revision', name: 'Bad', revision: 1, schemaVersion: 1})`,
    );
    await expect(integrity.inspectIntegrity()).resolves.toMatchObject({
      orphanEntities: 1,
      revisionMismatches: [{ projectId: "bad-revision", revision: 1, reflectionEvents: 0 }],
    });
  });

  it("migrates schema zero entities before installing current indexes", async () => {
    const graph = inspector.selectGraph(migrationGraphName);
    await graph.query(
      `CREATE (:MemoryOsSchema {id: 'primary', version: 0})
       CREATE (:Project {id: 'legacy', name: 'Legacy', revision: 0})
       CREATE (:Concept {id: 'legacy-concept', projectId: 'legacy', canonicalName: 'Legacy'})`,
    );
    const migrationStore = await FalkorDbMemoryStore.connect({ url: url!, graphName: migrationGraphName });

    try {
      await migrationStore.bootstrap({ embeddingDimension: 3 });
      const migrated = await graph.roQuery<{
        readonly version: number;
        readonly projectVersion: number;
        readonly conceptVersion: number;
      }>(
        `MATCH (schema:MemoryOsSchema {id: 'primary'}),
               (project:Project {id: 'legacy'}),
               (concept:Concept {id: 'legacy-concept'})
         RETURN schema.version AS version, project.schemaVersion AS projectVersion,
                concept.schemaVersion AS conceptVersion`,
      );
      expect(migrated.data?.[0]).toEqual({ version: 1, projectVersion: 1, conceptVersion: 1 });
    } finally {
      await migrationStore.close();
    }
  });
});
