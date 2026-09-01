import { FalkorDB, type Graph } from "falkordb";
import {
  searchTextForClaim,
  searchTextForConcept,
  searchTextForEvidence,
  type EmbeddingModelIdentity,
  type IndexedSearchDocument,
  type ReplaceSearchIndexResult,
  type SearchDocument,
  type SearchIndexMaintenanceStore,
} from "../../modules/retrieval/index.js";

interface IndexRow extends EmbeddingModelIdentity {}

interface ConceptDocumentRow {
  readonly projectId: string;
  readonly entityId: string;
  readonly canonicalName: string;
  readonly aliases: string[];
  readonly description: string | null;
  readonly conceptType: string;
}

interface ClaimDocumentRow {
  readonly projectId: string;
  readonly entityId: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string | null;
  readonly statement: string;
  readonly contextIds: string[];
}

interface EvidenceDocumentRow {
  readonly projectId: string;
  readonly entityId: string;
  readonly summary: string;
  readonly content: string | null;
  readonly quote: string | null;
  readonly file: string | null;
  readonly symbol: string | null;
  readonly command: string | null;
  readonly result: string | null;
}

interface UpdatedRow {
  readonly updatedDocuments: number;
}

function groupedDocuments(documents: readonly IndexedSearchDocument[]) {
  const map = (entityType: IndexedSearchDocument["entityType"]) =>
    documents
      .filter((document) => document.entityType === entityType)
      .map((document) => ({
        projectId: document.projectId,
        entityId: document.entityId,
        text: document.text,
        vector: [...document.vector],
      }));
  return {
    concepts: map("concept"),
    claims: map("claim"),
    evidence: map("evidence"),
  };
}

export class FalkorDbSearchIndexStore implements SearchIndexMaintenanceStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: {
    readonly url: string;
    readonly graphName?: string;
  }): Promise<FalkorDbSearchIndexStore> {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbSearchIndexStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async getIndexIdentity(): Promise<EmbeddingModelIdentity | null> {
    const result = await this.#graph.roQuery<IndexRow>(
      `MATCH (index:EmbeddingIndex {id: 'primary'})
       RETURN index.provider AS provider,
              index.model AS model,
              index.digest AS digest,
              index.dimension AS dimension`,
    );
    return result.data?.[0] ?? null;
  }

  async loadSearchDocuments(): Promise<readonly SearchDocument[]> {
    const [conceptResult, claimResult, evidenceResult] = await Promise.all([
      this.#graph.roQuery<ConceptDocumentRow>(
        `MATCH (concept:Concept)
         RETURN concept.projectId AS projectId,
                concept.id AS entityId,
                concept.canonicalName AS canonicalName,
                concept.aliases AS aliases,
                concept.description AS description,
                concept.conceptType AS conceptType
         ORDER BY concept.projectId, concept.id`,
      ),
      this.#graph.roQuery<ClaimDocumentRow>(
        `MATCH (claim:Claim)-[:SUBJECT]->(subject:Concept)
         OPTIONAL MATCH (claim)-[:OBJECT]->(object:Concept)
         OPTIONAL MATCH (claim)-[:APPLIES_IN]->(context:Context)
         RETURN claim.projectId AS projectId,
                claim.id AS entityId,
                subject.id AS subjectId,
                claim.predicate AS predicate,
                object.id AS objectId,
                claim.statement AS statement,
                collect(DISTINCT context.id) AS contextIds
         ORDER BY claim.projectId, claim.id`,
      ),
      this.#graph.roQuery<EvidenceDocumentRow>(
        `MATCH (evidence:Evidence)
         RETURN evidence.projectId AS projectId,
                evidence.id AS entityId,
                evidence.summary AS summary,
                evidence.content AS content,
                evidence.quote AS quote,
                evidence.file AS file,
                evidence.symbol AS symbol,
                evidence.command AS command,
                evidence.result AS result
         ORDER BY evidence.projectId, evidence.id`,
      ),
    ]);

    return [
      ...(conceptResult.data ?? []).map((row) => ({
        projectId: row.projectId,
        entityId: row.entityId,
        entityType: "concept" as const,
        text: searchTextForConcept(row),
      })),
      ...(claimResult.data ?? []).map((row) => ({
        projectId: row.projectId,
        entityId: row.entityId,
        entityType: "claim" as const,
        text: searchTextForClaim(row),
      })),
      ...(evidenceResult.data ?? []).map((row) => ({
        projectId: row.projectId,
        entityId: row.entityId,
        entityType: "evidence" as const,
        text: searchTextForEvidence(row),
      })),
    ];
  }

  async replaceSearchIndex(input: {
    readonly expectedIdentity: EmbeddingModelIdentity;
    readonly identity: EmbeddingModelIdentity;
    readonly documents: readonly IndexedSearchDocument[];
    readonly indexedAt: string;
  }): Promise<ReplaceSearchIndexResult> {
    const documents = groupedDocuments(input.documents);
    const result = await this.#graph.query<UpdatedRow>(
      `MATCH (index:EmbeddingIndex {id: 'primary'})
       WHERE index.provider = $expected.provider
         AND index.model = $expected.model
         AND index.digest = $expected.digest
         AND index.dimension = $expected.dimension
       CALL {
         WITH index
         UNWIND $concepts AS item
         OPTIONAL MATCH (node:Concept {projectId: item.projectId, id: item.entityId})
         RETURN count(node) AS existingConceptCount
       }
       WITH index, existingConceptCount
       CALL {
         WITH index
         UNWIND $claims AS item
         OPTIONAL MATCH (node:Claim {projectId: item.projectId, id: item.entityId})
         RETURN count(node) AS existingClaimCount
       }
       WITH index, existingConceptCount, existingClaimCount
       CALL {
         WITH index
         UNWIND $evidence AS item
         OPTIONAL MATCH (node:Evidence {projectId: item.projectId, id: item.entityId})
         RETURN count(node) AS existingEvidenceCount
       }
       WITH index, existingConceptCount, existingClaimCount, existingEvidenceCount
       WHERE existingConceptCount + existingClaimCount + existingEvidenceCount = $documentCount
       CALL {
         WITH index
         UNWIND $concepts AS item
         MATCH (node:Concept {projectId: item.projectId, id: item.entityId})
         SET node.embedding = vecf32(item.vector),
             node.embeddingText = item.text,
             node.embeddingProvider = $identity.provider,
             node.embeddingModel = $identity.model,
             node.embeddingDigest = $identity.digest,
             node.embeddingDimension = $identity.dimension,
             node.embeddingUpdatedAt = $indexedAt
         RETURN count(node) AS conceptCount
       }
       WITH index, conceptCount
       CALL {
         WITH index
         UNWIND $claims AS item
         MATCH (node:Claim {projectId: item.projectId, id: item.entityId})
         SET node.embedding = vecf32(item.vector),
             node.embeddingText = item.text,
             node.embeddingProvider = $identity.provider,
             node.embeddingModel = $identity.model,
             node.embeddingDigest = $identity.digest,
             node.embeddingDimension = $identity.dimension,
             node.embeddingUpdatedAt = $indexedAt
         RETURN count(node) AS claimCount
       }
       WITH index, conceptCount, claimCount
       CALL {
         WITH index
         UNWIND $evidence AS item
         MATCH (node:Evidence {projectId: item.projectId, id: item.entityId})
         SET node.embedding = vecf32(item.vector),
             node.embeddingText = item.text,
             node.embeddingProvider = $identity.provider,
             node.embeddingModel = $identity.model,
             node.embeddingDigest = $identity.digest,
             node.embeddingDimension = $identity.dimension,
             node.embeddingUpdatedAt = $indexedAt
         RETURN count(node) AS evidenceCount
       }
       WITH index, conceptCount, claimCount, evidenceCount
       SET index.provider = $identity.provider,
           index.model = $identity.model,
           index.digest = $identity.digest,
           index.dimension = $identity.dimension,
           index.updatedAt = $indexedAt
       RETURN conceptCount + claimCount + evidenceCount AS updatedDocuments`,
      {
        params: {
          expected: { ...input.expectedIdentity },
          identity: { ...input.identity },
          indexedAt: input.indexedAt,
          documentCount: input.documents.length,
          ...documents,
        },
      },
    );
    const updated = result.data?.[0];
    if (updated !== undefined) {
      if (updated.updatedDocuments !== input.documents.length) {
        throw new Error(
          `Reindex updated ${updated.updatedDocuments} of ${input.documents.length} documents.`,
        );
      }
      return { ok: true, updatedDocuments: updated.updatedDocuments };
    }
    return { ok: false, actualIdentity: await this.getIndexIdentity() };
  }
}
