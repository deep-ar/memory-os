import { FalkorDB, type Graph } from "falkordb";
import { z } from "zod";
import type {
  ClaimRelationType,
  KnowledgeMapCatalogSource,
  KnowledgeMapClaimRecord,
  KnowledgeMapClaimRelation,
  KnowledgeMapConceptRecord,
  KnowledgeMapContextRecord,
  KnowledgeMapGraphSource,
  KnowledgeMapReadStore,
} from "../../modules/knowledge-map/index.js";

interface RevisionRow { readonly revision: number }
interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensionsJson: string;
  readonly conceptIds: readonly (string | null)[];
}
interface ClaimRow extends KnowledgeMapClaimRecord {}
interface ConceptRow extends KnowledgeMapConceptRecord {}
interface RelationRow {
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: string;
}

const dimensionsSchema = z.object({
  operatingSystem: z.string().nullable(),
  application: z.string().nullable(),
  runtime: z.string().nullable(),
  runtimeVersion: z.string().nullable(),
  framework: z.string().nullable(),
  frameworkVersion: z.string().nullable(),
  platform: z.string().nullable(),
  environment: z.string().nullable(),
});
const relationSchema = z.enum(["SUPPORTS", "CONTRADICTS", "SUPERSEDES", "REFINES", "DERIVED_FROM"]);

const CLAIM_FIELDS = `claim.id AS id,
  subject.id AS subjectId,
  claim.predicate AS predicate,
  object.id AS objectId,
  claim.statement AS statement,
  claim.epistemicBasis AS epistemicBasis,
  claim.confidenceLevel AS confidenceLevel,
  claim.lifecycleStatus AS lifecycleStatus,
  claim.validFrom AS validFrom,
  claim.validTo AS validTo,
  claim.lastVerifiedAt AS lastVerifiedAt,
  claim.createdAt AS createdAt,
  claim.updatedAt AS updatedAt,
  collect(DISTINCT context.id) AS contextIds,
  collect(DISTINCT evidence.id) AS evidenceIds`;

function compactIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export class FalkorDbKnowledgeMapReadStore implements KnowledgeMapReadStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: {
    readonly url: string;
    readonly graphName?: string;
  }): Promise<FalkorDbKnowledgeMapReadStore> {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbKnowledgeMapReadStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async loadCatalog(projectId: string): Promise<KnowledgeMapCatalogSource | null> {
    const revision = await this.#graph.roQuery<RevisionRow>(
      `MATCH (project:Project {id: $projectId}) RETURN project.revision AS revision`,
      { params: { projectId } },
    );
    const projectRevision = revision.data?.[0]?.revision;
    if (projectRevision === undefined) return null;

    const [contexts, claims] = await Promise.all([
      this.#graph.roQuery<ContextRow>(
        `MATCH (context:Context {projectId: $projectId})
         OPTIONAL MATCH (context)-[:DIMENSION_CONCEPT]->(concept:Concept {projectId: $projectId})
         RETURN context.id AS id, context.name AS name, context.description AS description,
                context.dimensionsJson AS dimensionsJson,
                collect(DISTINCT concept.id) AS conceptIds
         ORDER BY context.name, context.id`,
        { params: { projectId } },
      ),
      this.#graph.roQuery<ClaimRow>(
        `MATCH (claim:Claim {projectId: $projectId})-[:SUBJECT]->(subject:Concept {projectId: $projectId})
         OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept {projectId: $projectId})
         OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(evidence:Evidence {projectId: $projectId})
         OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context {projectId: $projectId})
         RETURN ${CLAIM_FIELDS}
         ORDER BY claim.id`,
        { params: { projectId } },
      ),
    ]);

    return {
      projectId,
      projectRevision,
      contexts: (contexts.data ?? []).map((row): KnowledgeMapContextRecord => ({
        id: row.id,
        name: row.name,
        description: row.description,
        dimensions: dimensionsSchema.parse(JSON.parse(row.dimensionsJson)),
        conceptIds: compactIds(row.conceptIds),
      })),
      claims: claims.data ?? [],
    };
  }

  async loadContextGraph(input: {
    readonly projectId: string;
    readonly contextId: string;
    readonly includeUnscoped: boolean;
    readonly includeBoundary: boolean;
  }): Promise<KnowledgeMapGraphSource | null> {
    const [revision, contextResult, primaryIdResult] = await Promise.all([
      this.#graph.roQuery<RevisionRow>(
        `MATCH (project:Project {id: $projectId}) RETURN project.revision AS revision`,
        { params: { projectId: input.projectId } },
      ),
      this.#graph.roQuery<ContextRow>(
        `MATCH (context:Context {projectId: $projectId, id: $contextId})
         OPTIONAL MATCH (context)-[:DIMENSION_CONCEPT]->(concept:Concept {projectId: $projectId})
         RETURN context.id AS id, context.name AS name, context.description AS description,
                context.dimensionsJson AS dimensionsJson,
                collect(DISTINCT concept.id) AS conceptIds`,
        { params: { projectId: input.projectId, contextId: input.contextId } },
      ),
      this.#graph.roQuery<{ readonly id: string }>(
        `MATCH (claim:Claim {projectId: $projectId})
         OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context {projectId: $projectId})
         WITH claim, collect(DISTINCT context.id) AS contextIds
         WHERE $contextId IN contextIds OR ($includeUnscoped AND size(contextIds) = 0)
         RETURN claim.id AS id ORDER BY claim.id`,
        { params: { projectId: input.projectId, contextId: input.contextId, includeUnscoped: input.includeUnscoped } },
      ),
    ]);
    const projectRevision = revision.data?.[0]?.revision;
    const contextRow = contextResult.data?.[0];
    if (projectRevision === undefined || contextRow === undefined) return null;
    const context: KnowledgeMapContextRecord = {
      id: contextRow.id,
      name: contextRow.name,
      description: contextRow.description,
      dimensions: dimensionsSchema.parse(JSON.parse(contextRow.dimensionsJson)),
      conceptIds: compactIds(contextRow.conceptIds),
    };

    const primaryIds = new Set((primaryIdResult.data ?? []).map((row) => row.id));
    let relations: KnowledgeMapClaimRelation[] = [];
    if (primaryIds.size > 0) {
      const result = await this.#graph.roQuery<RelationRow>(
        `MATCH (source:Claim {projectId: $projectId})-[relation:SUPPORTS|CONTRADICTS|SUPERSEDES|REFINES|DERIVED_FROM]->(target:Claim {projectId: $projectId})
         WHERE source.id IN $claimIds OR target.id IN $claimIds
         RETURN source.id AS sourceId, target.id AS targetId, type(relation) AS type
         ORDER BY type, source.id, target.id`,
        { params: { projectId: input.projectId, claimIds: [...primaryIds] } },
      );
      relations = (result.data ?? [])
        .map((row) => ({ ...row, type: relationSchema.parse(row.type) as ClaimRelationType }))
        .filter((relation) => input.includeBoundary
          || (primaryIds.has(relation.sourceId) && primaryIds.has(relation.targetId)));
    }

    const includedClaimIds = new Set(primaryIds);
    for (const relation of relations) {
      includedClaimIds.add(relation.sourceId);
      includedClaimIds.add(relation.targetId);
    }
    const includedClaims = await this.#loadClaims(input.projectId, [...includedClaimIds]);
    const conceptIds = new Set(context.conceptIds);
    for (const claim of includedClaims) {
      conceptIds.add(claim.subjectId);
      if (claim.objectId !== null) conceptIds.add(claim.objectId);
    }
    let concepts: readonly KnowledgeMapConceptRecord[] = [];
    if (conceptIds.size > 0) {
      concepts = await this.#loadConcepts(input.projectId, [...conceptIds]);
    }

    return {
      projectId: input.projectId,
      projectRevision,
      context,
      concepts,
      claims: includedClaims,
      relations,
    };
  }

  async #loadClaims(projectId: string, ids: readonly string[]): Promise<readonly KnowledgeMapClaimRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.#graph.roQuery<ClaimRow>(
      `MATCH (claim:Claim {projectId: $projectId})-[:SUBJECT]->(subject:Concept {projectId: $projectId})
       WHERE claim.id IN $ids
       OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept {projectId: $projectId})
       OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(evidence:Evidence {projectId: $projectId})
       OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context {projectId: $projectId})
       RETURN ${CLAIM_FIELDS}
       ORDER BY claim.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return result.data ?? [];
  }

  async #loadConcepts(projectId: string, ids: readonly string[]): Promise<readonly KnowledgeMapConceptRecord[]> {
    if (ids.length === 0) return [];
    const result = await this.#graph.roQuery<ConceptRow>(
      `MATCH (concept:Concept {projectId: $projectId})
       WHERE concept.id IN $ids
       RETURN concept.id AS id, concept.canonicalName AS canonicalName,
              concept.description AS description, concept.conceptType AS conceptType,
              concept.aliases AS aliases
       ORDER BY concept.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return result.data ?? [];
  }
}
