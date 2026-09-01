import { FalkorDB, type Graph } from "falkordb";
import { z } from "zod";
import type {
  ConnectedSubgraph,
  EmbeddingModelIdentity,
  RankedReference,
  RetrievalFilter,
  RetrievalStore,
  RetrievedClaim,
  RetrievedConcept,
  RetrievedContext,
  RetrievedEdge,
  RetrievedEvidence,
  SearchEntityType,
} from "../../modules/retrieval/index.js";

interface SearchRow {
  readonly entityId: string;
  readonly score: number;
}

interface ClaimIdRow {
  readonly claimId: string;
}

interface ClaimRelationRow {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

interface ClaimRow {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string | null;
  readonly statement: string;
  readonly epistemicBasis: RetrievedClaim["epistemicBasis"];
  readonly confidenceLevel: RetrievedClaim["confidenceLevel"];
  readonly lifecycleStatus: RetrievedClaim["lifecycleStatus"];
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly lastVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evidenceIds: string[];
  readonly contextIds: string[];
}

interface ConceptRow extends RetrievedConcept {}
interface EvidenceRow extends RetrievedEvidence {}

interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensionsJson: string;
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

const SEARCH_LABELS = [
  { label: "Concept", entityType: "concept" },
  { label: "Claim", entityType: "claim" },
  { label: "Evidence", entityType: "evidence" },
] as const;

const CLAIM_RELATION_TYPES = [
  "SUPPORTS",
  "CONTRADICTS",
  "SUPERSEDES",
  "REFINES",
  "DERIVED_FROM",
] as const;

function filterParams(filter: RetrievalFilter): Record<string, string | boolean | null> {
  return {
    includeActive: filter.include.active,
    includeDisputed: filter.include.disputed,
    includeHistorical: filter.include.historical,
    includeSuperseded: filter.include.superseded,
    includeInvalidated: filter.include.invalidated,
    at: filter.time.at,
    from: filter.time.from,
    to: filter.time.to,
  };
}

function temporalWhere(alias: string): string {
  return `($at IS NULL OR ${alias}.createdAt <= $at)
    AND ($from IS NULL OR ${alias}.createdAt >= $from)
    AND ($to IS NULL OR ${alias}.createdAt <= $to)`;
}

function claimWhere(alias: string): string {
  return `(${alias}.lifecycleStatus = 'active' AND $includeActive
      OR ${alias}.lifecycleStatus = 'disputed' AND $includeDisputed
      OR ${alias}.lifecycleStatus = 'historical' AND $includeHistorical
      OR ${alias}.lifecycleStatus = 'superseded' AND $includeSuperseded
      OR ${alias}.lifecycleStatus = 'invalidated' AND $includeInvalidated)
    AND ${temporalWhere(alias)}
    AND ($at IS NULL OR (${alias}.validFrom IS NULL OR ${alias}.validFrom <= $at)
      AND (${alias}.validTo IS NULL OR ${alias}.validTo > $at))`;
}

export function compileFalkorFullTextQuery(text: string): string | null {
  const tokens = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unique = [...new Set(tokens
    .map((token) => token.toLowerCase())
    .filter((token) => /[\p{L}\p{N}]/u.test(token)))];
  return unique.length === 0 ? null : unique.join("|");
}

function sortedReferences(
  rows: readonly (SearchRow & { readonly entityType: SearchEntityType })[],
  limit: number,
  scoreOrder: "ascending" | "descending",
): readonly RankedReference[] {
  return [...rows]
    .sort(
      (left, right) =>
        (scoreOrder === "ascending" ? left.score - right.score : right.score - left.score) ||
        left.entityType.localeCompare(right.entityType) ||
        left.entityId.localeCompare(right.entityId),
    )
    .slice(0, limit)
    .map(({ entityId, entityType }) => ({ entityId, entityType }));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export class FalkorDbRetrievalStore implements RetrievalStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: {
    readonly url: string;
    readonly graphName?: string;
  }): Promise<FalkorDbRetrievalStore> {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbRetrievalStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async searchSemantic(input: {
    readonly projectId: string;
    readonly vector: readonly number[];
    readonly identity: EmbeddingModelIdentity;
    readonly filter: RetrievalFilter;
    readonly limit: number;
  }): Promise<readonly RankedReference[]> {
    const rows = await Promise.all(
      SEARCH_LABELS.map(async ({ label, entityType }) => {
        const where = entityType === "claim" ? claimWhere("node") : temporalWhere("node");
        const result = await this.#graph.roQuery<SearchRow>(
          `CALL db.idx.vector.queryNodes('${label}', 'embedding', $limit, vecf32($vector))
           YIELD node, score
           WHERE node.projectId = $projectId
             AND node.embeddingProvider = $provider
             AND node.embeddingModel = $model
             AND node.embeddingDigest = $digest
             AND node.embeddingDimension = $dimension
             AND ${where}
           RETURN node.id AS entityId, score
           ORDER BY score ASC
           LIMIT $limit`,
          {
            params: {
              projectId: input.projectId,
              vector: [...input.vector],
              provider: input.identity.provider,
              model: input.identity.model,
              digest: input.identity.digest,
              dimension: input.identity.dimension,
              limit: input.limit,
              ...filterParams(input.filter),
            },
          },
        );
        return (result.data ?? []).map((row) => ({ ...row, entityType }));
      }),
    );
    // FalkorDB's vector procedure returns cosine distance: lower is nearer.
    return sortedReferences(rows.flat(), input.limit, "ascending");
  }

  async searchFullText(input: {
    readonly projectId: string;
    readonly query: string;
    readonly filter: RetrievalFilter;
    readonly limit: number;
  }): Promise<readonly RankedReference[]> {
    const query = compileFalkorFullTextQuery(input.query);
    if (query === null) {
      return [];
    }
    const rows = await Promise.all(
      SEARCH_LABELS.map(async ({ label, entityType }) => {
        const where = entityType === "claim" ? claimWhere("node") : temporalWhere("node");
        const result = await this.#graph.roQuery<SearchRow>(
          `CALL db.idx.fulltext.queryNodes('${label}', $query)
           YIELD node, score
           WHERE node.projectId = $projectId AND ${where}
           RETURN node.id AS entityId, score
           ORDER BY score DESC
           LIMIT $limit`,
          {
            params: {
              projectId: input.projectId,
              query,
              limit: input.limit,
              ...filterParams(input.filter),
            },
          },
        );
        return (result.data ?? []).map((row) => ({ ...row, entityType }));
      }),
    );
    return sortedReferences(rows.flat(), input.limit, "descending");
  }

  async loadConnectedSubgraph(input: {
    readonly projectId: string;
    readonly entryPoints: readonly RankedReference[];
    readonly filter: RetrievalFilter;
    readonly graphDepth: number;
  }): Promise<ConnectedSubgraph> {
    const entryIds = unique(input.entryPoints.map((entry) => entry.entityId));
    if (entryIds.length === 0) {
      return {
        concepts: [],
        claims: [],
        evidence: [],
        contexts: [],
        edges: [],
        graphClaimRanking: [],
      };
    }

    const seedResult = await this.#graph.roQuery<ClaimIdRow>(
      `MATCH (claim:Claim {projectId: $projectId})
       OPTIONAL MATCH (claim)-[:SUBJECT|OBJECT|SUPPORTED_BY|APPLIES_IN]->(linked)
       WITH claim, collect(linked.id) AS linkedIds
       WHERE (claim.id IN $entryIds OR any(linkedId IN linkedIds WHERE linkedId IN $entryIds))
         AND ${claimWhere("claim")}
       RETURN claim.id AS claimId
       ORDER BY claim.createdAt DESC, claim.id`,
      {
        params: {
          projectId: input.projectId,
          entryIds,
          ...filterParams(input.filter),
        },
      },
    );
    const claimOrder = unique((seedResult.data ?? []).map((row) => row.claimId));
    const knownClaims = new Set(claimOrder);
    let frontier = [...claimOrder];
    const relationEdges: RetrievedEdge[] = [];

    for (let depth = 0; depth < input.graphDepth && frontier.length > 0; depth += 1) {
      const relationResult = await this.#graph.roQuery<ClaimRelationRow>(
        `MATCH (source:Claim {projectId: $projectId})-[relation:${CLAIM_RELATION_TYPES.join("|")}]->(target:Claim {projectId: $projectId})
         WHERE (source.id IN $frontier OR target.id IN $frontier)
           AND ${claimWhere("source")}
           AND ${claimWhere("target")}
         RETURN source.id AS from, target.id AS to, type(relation) AS type
         ORDER BY source.id, target.id, type`,
        {
          params: {
            projectId: input.projectId,
            frontier,
            ...filterParams(input.filter),
          },
        },
      );
      const next: string[] = [];
      for (const edge of relationResult.data ?? []) {
        relationEdges.push(edge);
        for (const id of [edge.from, edge.to]) {
          if (!knownClaims.has(id)) {
            knownClaims.add(id);
            claimOrder.push(id);
            next.push(id);
          }
        }
      }
      frontier = next;
    }

    const claims = await this.#loadClaims(input.projectId, claimOrder);
    const conceptIds = unique([
      ...input.entryPoints
        .filter((entry) => entry.entityType === "concept")
        .map((entry) => entry.entityId),
      ...claims.flatMap((claim) => [claim.subjectId, claim.objectId].filter((id): id is string => id !== null)),
    ]);
    const evidenceIds = unique([
      ...input.entryPoints
        .filter((entry) => entry.entityType === "evidence")
        .map((entry) => entry.entityId),
      ...claims.flatMap((claim) => claim.evidenceIds),
    ]);
    const contextIds = unique(claims.flatMap((claim) => claim.contextIds));
    const [concepts, evidence, contexts] = await Promise.all([
      this.#loadConcepts(input.projectId, conceptIds),
      this.#loadEvidence(input.projectId, evidenceIds),
      this.#loadContexts(input.projectId, contextIds),
    ]);
    const attachmentEdges: RetrievedEdge[] = claims.flatMap((claim) => [
      { from: claim.id, to: claim.subjectId, type: "SUBJECT" },
      ...(claim.objectId === null
        ? []
        : [{ from: claim.id, to: claim.objectId, type: "OBJECT" }]),
      ...claim.evidenceIds.map((id) => ({ from: claim.id, to: id, type: "SUPPORTED_BY" })),
      ...claim.contextIds.map((id) => ({ from: claim.id, to: id, type: "APPLIES_IN" })),
    ]);

    return {
      concepts,
      claims,
      evidence,
      contexts,
      edges: unique([...relationEdges, ...attachmentEdges].map((edge) => JSON.stringify(edge))).map(
        (edge) => JSON.parse(edge) as RetrievedEdge,
      ),
      graphClaimRanking: claimOrder.map((entityId) => ({ entityId, entityType: "claim" })),
    };
  }

  async #loadClaims(projectId: string, claimIds: readonly string[]): Promise<RetrievedClaim[]> {
    if (claimIds.length === 0) {
      return [];
    }
    const result = await this.#graph.roQuery<ClaimRow>(
      `MATCH (claim:Claim {projectId: $projectId})
       WHERE claim.id IN $claimIds
       MATCH (claim)-[:SUBJECT]->(subject:Concept)
       OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept)
       OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(evidence:Evidence)
       OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context)
       RETURN claim.id AS id,
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
              collect(DISTINCT evidence.id) AS evidenceIds,
              collect(DISTINCT context.id) AS contextIds`,
      { params: { projectId, claimIds: [...claimIds] } },
    );
    const order = new Map(claimIds.map((id, index) => [id, index]));
    return [...(result.data ?? [])].sort(
      (left, right) => order.get(left.id)! - order.get(right.id)!,
    );
  }

  async #loadConcepts(projectId: string, ids: readonly string[]): Promise<RetrievedConcept[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.#graph.roQuery<ConceptRow>(
      `MATCH (concept:Concept {projectId: $projectId})
       WHERE concept.id IN $ids
       RETURN concept.id AS id,
              concept.canonicalName AS canonicalName,
              concept.description AS description,
              concept.conceptType AS conceptType,
              concept.aliases AS aliases
       ORDER BY concept.canonicalName, concept.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return result.data ?? [];
  }

  async #loadEvidence(projectId: string, ids: readonly string[]): Promise<RetrievedEvidence[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.#graph.roQuery<EvidenceRow>(
      `MATCH (evidence:Evidence {projectId: $projectId})
       WHERE evidence.id IN $ids
       RETURN evidence.id AS id,
              evidence.type AS type,
              evidence.summary AS summary,
              evidence.sourceUri AS sourceUri,
              evidence.file AS file,
              evidence.observedAt AS observedAt
       ORDER BY evidence.createdAt, evidence.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return result.data ?? [];
  }

  async #loadContexts(projectId: string, ids: readonly string[]): Promise<RetrievedContext[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.#graph.roQuery<ContextRow>(
      `MATCH (context:Context {projectId: $projectId})
       WHERE context.id IN $ids
       RETURN context.id AS id,
              context.name AS name,
              context.description AS description,
              context.dimensionsJson AS dimensionsJson
       ORDER BY context.name, context.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return (result.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      dimensions: dimensionsSchema.parse(JSON.parse(row.dimensionsJson)),
    }));
  }
}
