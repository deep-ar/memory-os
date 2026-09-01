import { FalkorDB, type Graph } from "falkordb";
import type { HardDeleteRecord, SensitiveDataDeletionStore } from "../../modules/sensitive-data/index.js";

interface DeleteRow { readonly auditId: string }

export class FalkorDbSensitiveDataStore implements SensitiveDataDeletionStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: { readonly url: string; readonly graphName?: string }) {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbSensitiveDataStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> { await this.#db.close(); }

  async hardDeleteEvidence(record: HardDeleteRecord, evidenceId: string): Promise<boolean> {
    const result = await this.#graph.query<DeleteRow>(
      `MATCH (project:Project {id: $projectId})
       MATCH (evidence:Evidence {projectId: $projectId, id: $evidenceId})
       DETACH DELETE evidence
       CREATE (audit:HardDeleteAudit {
         id: $auditId, projectId: $projectId, entityType: $entityType,
         entityIdHash: $entityIdHash, reason: $reason, actor: $actor,
         deletedAt: $deletedAt, schemaVersion: 1
       })
       CREATE (project)-[:HAS_HARD_DELETE_AUDIT]->(audit)
       RETURN audit.id AS auditId`,
      { params: { ...record, evidenceId } },
    );
    return result.data?.[0]?.auditId === record.auditId;
  }
}
