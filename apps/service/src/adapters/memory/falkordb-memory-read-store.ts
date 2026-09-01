import { FalkorDB, type Graph } from "falkordb";
import { z } from "zod";
import type {
  ClaimExplanation,
  ConflictCandidateInput,
  FullEvidence,
  FullClaim,
  HistoryInput,
  MemoryReadStore,
  PotentialConflict,
  ReflectionHistoryEvent,
} from "../../modules/memory-tools/index.js";
import type {
  RetrievedClaim,
  RetrievedContext,
} from "../../modules/retrieval/index.js";

interface ClaimRow extends RetrievedClaim {
  readonly projectId: string;
  readonly provenanceJson: string;
  readonly supports: string[];
  readonly contradicts: string[];
  readonly supersedes: string[];
  readonly refines: string[];
  readonly derivedFrom: string[];
  readonly schemaVersion: 1;
  readonly revision: number;
}

interface ContextRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly dimensionsJson: string;
}

interface EvidenceRow extends FullEvidence {}

interface RelatedClaimRow {
  readonly relation: "SUPPORTS" | "CONTRADICTS" | "SUPERSEDES";
  readonly direction: "incoming" | "outgoing";
  readonly claimId: string;
}

interface ConflictRow extends RetrievedClaim {
  readonly provenanceJson: string;
  readonly evidenceSummaries: string[];
}

interface HistoryRow {
  readonly id: string;
  readonly projectId: string;
  readonly trigger: string;
  readonly createdAt: string;
  readonly metadataJson: string;
  readonly operationsJson: string;
}

interface ProjectRevisionRow { readonly revision: number }

const metadataSchema = z.record(z.string(), z.string().nullable());
const operationsSchema = z.array(z.object({ type: z.string(), entityId: z.string() }));
const provenanceSchema = z.object({
  reflectionEventId: z.string(),
  agentId: z.string().nullable(),
  agentType: z.string().nullable(),
  sessionId: z.string().nullable(),
  taskId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  worktreeId: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
});
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

const BASE_CLAIM_FIELDS = `claim.id AS id,
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
  claim.provenanceJson AS provenanceJson,
  collect(DISTINCT evidence.id) AS evidenceIds,
  collect(DISTINCT context.id) AS contextIds`;

const FULL_CLAIM_FIELDS = `${BASE_CLAIM_FIELDS},
  claim.projectId AS projectId,
  collect(DISTINCT supports.id) AS supports,
  collect(DISTINCT contradicts.id) AS contradicts,
  collect(DISTINCT supersedes.id) AS supersedes,
  collect(DISTINCT refines.id) AS refines,
  collect(DISTINCT derivedFrom.id) AS derivedFrom,
  claim.schemaVersion AS schemaVersion,
  claim.revision AS revision`;

function normalizeInstant(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new RangeError(`Invalid datetime '${value}'.`);
  return new Date(time).toISOString();
}

function intervalsOverlap(
  leftFrom: string | null,
  leftTo: string | null,
  rightFrom: string | null,
  rightTo: string | null,
): boolean {
  return (leftTo === null || rightFrom === null || rightFrom < leftTo)
    && (rightTo === null || leftFrom === null || leftFrom < rightTo);
}

function lexicalSimilarity(left: string, right: string): number {
  const words = (text: string) => new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  const a = words(left);
  const b = words(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / union.size;
}

function fullClaimFromRow(row: ClaimRow): FullClaim {
  const { provenanceJson, ...claim } = row;
  return { ...claim, provenance: provenanceSchema.parse(JSON.parse(provenanceJson)) };
}

export class FalkorDbMemoryReadStore implements MemoryReadStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: {
    readonly url: string;
    readonly graphName?: string;
  }): Promise<FalkorDbMemoryReadStore> {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbMemoryReadStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async getProjectRevision(projectId: string): Promise<number | null> {
    const result = await this.#graph.roQuery<ProjectRevisionRow>(
      `MATCH (project:Project {id: $projectId}) RETURN project.revision AS revision`,
      { params: { projectId } },
    );
    return result.data?.[0]?.revision ?? null;
  }

  async getClaim(projectId: string, claimId: string): Promise<FullClaim | null> {
    const row = await this.#getClaimRow(projectId, claimId);
    if (row === null) return null;
    return fullClaimFromRow(row);
  }

  async explainClaim(projectId: string, claimId: string): Promise<ClaimExplanation | null> {
    const row = await this.#getClaimRow(projectId, claimId);
    if (row === null) return null;
    const fullClaim = fullClaimFromRow(row);
    const [contexts, evidence, relations, reflectionHistory] = await Promise.all([
      this.#loadContexts(projectId, fullClaim.contextIds),
      this.#loadEvidence(projectId, fullClaim.evidenceIds),
      this.#graph.roQuery<RelatedClaimRow>(
        `MATCH (claim:Claim {projectId: $projectId, id: $claimId})
         MATCH (other:Claim {projectId: $projectId})-[relation:SUPPORTS|CONTRADICTS|SUPERSEDES]->(claim)
         RETURN type(relation) AS relation, 'incoming' AS direction, other.id AS claimId
         UNION
         MATCH (claim:Claim {projectId: $projectId, id: $claimId})-[relation:SUPPORTS|CONTRADICTS|SUPERSEDES]->(other:Claim {projectId: $projectId})
         RETURN type(relation) AS relation, 'outgoing' AS direction, other.id AS claimId`,
        { params: { projectId, claimId } },
      ),
      this.history({ projectId, entityType: "claim", entityId: claimId, limit: 100 }),
    ]);
    const relationRows = relations.data ?? [];
    const supportingIds = relationRows
      .filter((item) => item.relation === "SUPPORTS" && item.direction === "incoming")
      .map((item) => item.claimId);
    const contradictingIds = relationRows
      .filter((item) => item.relation === "CONTRADICTS")
      .map((item) => item.claimId);
    const supersededIds = relationRows
      .filter((item) => item.relation === "SUPERSEDES" && item.direction === "outgoing")
      .map((item) => item.claimId);
    const [supportingClaims, contradictingClaims, supersededClaims] = await Promise.all([
      this.#loadClaims(projectId, supportingIds),
      this.#loadClaims(projectId, contradictingIds),
      this.#loadClaims(projectId, supersededIds),
    ]);

    return {
      claim: fullClaim,
      epistemicState: {
        basis: fullClaim.epistemicBasis,
        confidence: fullClaim.confidenceLevel,
        lifecycleStatus: fullClaim.lifecycleStatus,
      },
      contexts,
      supportingEvidence: evidence,
      supportingClaims,
      contradictingClaims,
      supersededClaims,
      provenance: fullClaim.provenance,
      reflectionHistory,
    };
  }

  async findConflicts(input: ConflictCandidateInput): Promise<readonly PotentialConflict[]> {
    const result = await this.#graph.roQuery<ConflictRow>(
      `MATCH (claim:Claim {projectId: $projectId})-[:SUBJECT]->(subject:Concept {id: $subjectId})
       OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept)
       OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(evidence:Evidence)
       OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context)
       RETURN ${BASE_CLAIM_FIELDS}, collect(DISTINCT evidence.summary) AS evidenceSummaries
       ORDER BY claim.updatedAt DESC, claim.id
       LIMIT 100`,
      { params: { projectId: input.projectId, subjectId: input.subjectId } },
    );
    const from = normalizeInstant(input.validFrom);
    const to = normalizeInstant(input.validTo);
    return (result.data ?? []).map((claim) => {
      const contextOverlap = claim.contextIds.filter((id) => input.contextIds.includes(id));
      return {
        claimId: claim.id,
        similarity: lexicalSimilarity(input.statement, claim.statement),
        conflictReason: claim.predicate === input.predicate
          ? "same_subject_predicate" as const
          : "same_subject" as const,
        contextOverlap,
        temporalOverlap: intervalsOverlap(from, to, claim.validFrom, claim.validTo),
        evidenceSummary: claim.evidenceSummaries.filter(Boolean),
      };
    });
  }

  async history(input: HistoryInput): Promise<readonly ReflectionHistoryEvent[]> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("limit must be an integer between 1 and 1000.");
    }
    const from = normalizeInstant(input.from);
    const to = normalizeInstant(input.to);
    if (from !== null && to !== null && from > to) {
      throw new RangeError("from must not be later than to.");
    }
    const result = await this.#graph.roQuery<HistoryRow>(
      `MATCH (event:ReflectionEvent {projectId: $projectId})
       OPTIONAL MATCH (event)-[:CREATED]->(entity)
       WITH event, collect(DISTINCT entity) AS entities
       WHERE ($from IS NULL OR event.createdAt >= $from)
         AND ($to IS NULL OR event.createdAt <= $to)
         AND (($entityId IS NULL AND $entityType IS NULL) OR any(entity IN entities WHERE
           ($entityId IS NULL OR entity.id = $entityId)
           AND ($entityType IS NULL OR any(label IN labels(entity) WHERE toLower(label) = toLower($entityType)))))
       RETURN event.id AS id, event.projectId AS projectId, event.trigger AS trigger,
              event.createdAt AS createdAt, event.metadataJson AS metadataJson,
              event.operationsJson AS operationsJson
       ORDER BY event.createdAt, event.id
       LIMIT $limit`,
      {
        params: {
          projectId: input.projectId,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          from,
          to,
          limit,
        },
      },
    );
    return (result.data ?? []).map((row) => ({
      id: row.id,
      projectId: row.projectId,
      trigger: row.trigger,
      createdAt: row.createdAt,
      metadata: metadataSchema.parse(JSON.parse(row.metadataJson)),
      operations: operationsSchema.parse(JSON.parse(row.operationsJson)),
    }));
  }

  async #getClaimRow(projectId: string, claimId: string): Promise<ClaimRow | null> {
    const result = await this.#graph.roQuery<ClaimRow>(
      `MATCH (claim:Claim {projectId: $projectId, id: $claimId})-[:SUBJECT]->(subject:Concept)
       OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept)
       OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(evidence:Evidence)
       OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context)
       OPTIONAL MATCH (claim)-[:SUPPORTS]->(supports:Claim)
       OPTIONAL MATCH (claim)-[:CONTRADICTS]->(contradicts:Claim)
       OPTIONAL MATCH (claim)-[:SUPERSEDES]->(supersedes:Claim)
       OPTIONAL MATCH (claim)-[:REFINES]->(refines:Claim)
       OPTIONAL MATCH (claim)-[:DERIVED_FROM]->(derivedFrom:Claim)
       RETURN ${FULL_CLAIM_FIELDS}`,
      { params: { projectId, claimId } },
    );
    return result.data?.[0] ?? null;
  }

  async #loadClaims(projectId: string, ids: readonly string[]): Promise<RetrievedClaim[]> {
    const claims = await Promise.all(ids.map(async (id) => {
      const row = await this.#getClaimRow(projectId, id);
      if (row === null) return null;
      const { provenanceJson: _provenanceJson, projectId: _projectId, supports: _supports,
        contradicts: _contradicts, supersedes: _supersedes, refines: _refines,
        derivedFrom: _derivedFrom, schemaVersion: _schemaVersion, revision: _revision, ...claim } = row;
      return claim;
    }));
    return claims.filter((claim): claim is RetrievedClaim => claim !== null);
  }

  async #loadEvidence(projectId: string, ids: readonly string[]): Promise<FullEvidence[]> {
    if (ids.length === 0) return [];
    const result = await this.#graph.roQuery<EvidenceRow>(
      `MATCH (evidence:Evidence {projectId: $projectId}) WHERE evidence.id IN $ids
       RETURN evidence.id AS id, evidence.projectId AS projectId,
              evidence.type AS type, evidence.summary AS summary, evidence.content AS content,
              evidence.sourceUri AS sourceUri, evidence.repo AS repo, evidence.commit AS commit,
              evidence.branch AS branch, evidence.file AS file, evidence.symbol AS symbol,
              evidence.lineStart AS lineStart, evidence.lineEnd AS lineEnd,
              evidence.command AS command, evidence.result AS result, evidence.quote AS quote,
              evidence.observedAt AS observedAt, evidence.retrievedAt AS retrievedAt,
              evidence.contentHash AS contentHash, evidence.createdAt AS createdAt,
              evidence.schemaVersion AS schemaVersion
       ORDER BY evidence.createdAt, evidence.id`,
      { params: { projectId, ids: [...ids] } },
    );
    return result.data ?? [];
  }

  async #loadContexts(projectId: string, ids: readonly string[]): Promise<RetrievedContext[]> {
    if (ids.length === 0) return [];
    const result = await this.#graph.roQuery<ContextRow>(
      `MATCH (context:Context {projectId: $projectId}) WHERE context.id IN $ids
       RETURN context.id AS id, context.name AS name, context.description AS description,
              context.dimensionsJson AS dimensionsJson ORDER BY context.name, context.id`,
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
