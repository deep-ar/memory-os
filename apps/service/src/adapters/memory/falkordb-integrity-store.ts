import { FalkorDB, type Graph } from "falkordb";
import type {
  IntegrityCounts,
  IntegrityFactStore,
  IntegrityFacts,
  RevisionMismatch,
} from "../../modules/integrity/index.js";

interface CountRow { readonly count: number }
interface SchemaRow { readonly version: number | null }
interface RevisionRow { readonly projectId: string; readonly revision: number; readonly reflectionEvents: number }

const LABELS = ["Project", "Concept", "Claim", "Evidence", "Context", "ReflectionEvent"] as const;
const VERSIONED_LABELS = [...LABELS, "HardDeleteAudit"] as const;
const COUNT_KEYS: Record<(typeof LABELS)[number], keyof IntegrityCounts> = {
  Project: "projects", Concept: "concepts", Claim: "claims", Evidence: "evidence",
  Context: "contexts", ReflectionEvent: "reflectionEvents",
};

export class FalkorDbIntegrityStore implements IntegrityFactStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: { readonly url: string; readonly graphName?: string }) {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbIntegrityStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> { await this.#db.close(); }

  async #count(query: string): Promise<number> {
    const result = await this.#graph.roQuery<CountRow>(query);
    return result.data?.[0]?.count ?? 0;
  }

  async inspectIntegrity(): Promise<IntegrityFacts> {
    const [schema, labelCounts, schemaViolations, orphanCounts, claimsWithoutSingleSubject,
      crossProjectRelationships, revisionRows, lifecycleCounts] = await Promise.all([
      this.#graph.roQuery<SchemaRow>(
        "OPTIONAL MATCH (schema:MemoryOsSchema {id: 'primary'}) RETURN schema.version AS version",
      ),
      Promise.all(LABELS.map(async (label) => [label, await this.#count(
        `MATCH (entity:${label}) RETURN count(entity) AS count`,
      )] as const)),
      Promise.all(VERSIONED_LABELS.map((label) => this.#count(
        `MATCH (entity:${label}) WHERE entity.schemaVersion IS NULL OR entity.schemaVersion <> 1 RETURN count(entity) AS count`,
      ))),
      Promise.all(VERSIONED_LABELS.filter((label) => label !== "Project").map((label) => this.#count(
        `MATCH (entity:${label})
         OPTIONAL MATCH (project:Project {id: entity.projectId})
         WITH entity, project WHERE project IS NULL
         RETURN count(entity) AS count`,
      ))),
      this.#count(
        `MATCH (claim:Claim)
         OPTIONAL MATCH (claim)-[:SUBJECT]->(subject:Concept {projectId: claim.projectId})
         WITH claim, count(subject) AS subjects WHERE subjects <> 1
         RETURN count(claim) AS count`,
      ),
      this.#count(
        `MATCH (left)-[relation]->(right)
         WHERE left.projectId IS NOT NULL AND right.projectId IS NOT NULL
           AND left.projectId <> right.projectId
         RETURN count(relation) AS count`,
      ),
      this.#graph.roQuery<RevisionRow>(
        `MATCH (project:Project)
         OPTIONAL MATCH (event:ReflectionEvent)-[:IN_PROJECT]->(project)
         RETURN project.id AS projectId, project.revision AS revision,
                count(event) AS reflectionEvents`,
      ),
      Promise.all(["active", "disputed", "superseded", "invalidated"].map((status) => this.#count(
        `MATCH (claim:Claim {lifecycleStatus: '${status}'}) RETURN count(claim) AS count`,
      ))),
    ]);
    const counts = Object.fromEntries(
      labelCounts.map(([label, count]) => [COUNT_KEYS[label], count]),
    ) as unknown as IntegrityCounts;
    const [activeClaims = 0, disputedClaims = 0, supersededClaims = 0, invalidatedClaims = 0] = lifecycleCounts;
    const revisionMismatches: RevisionMismatch[] = (revisionRows.data ?? [])
      .filter((row) => row.revision !== row.reflectionEvents);
    return {
      schemaVersion: schema.data?.[0]?.version ?? null,
      counts: { ...counts, activeClaims, disputedClaims, supersededClaims, invalidatedClaims },
      schemaVersionViolations: schemaViolations.reduce((sum, count) => sum + count, 0),
      orphanEntities: orphanCounts.reduce((sum, count) => sum + count, 0),
      claimsWithoutSingleSubject,
      crossProjectRelationships,
      revisionMismatches,
    };
  }
}
