import { randomUUID } from "node:crypto";
import { FalkorDB, type Graph } from "falkordb";
import type {
  PreparedMemoryDelta,
  Project,
  ProjectId,
  ProjectSnapshot,
} from "../../modules/knowledge/index.js";
import type {
  ProjectCatalogStore,
  ProjectOverview,
  ProjectRegistrationStore,
} from "../../modules/projects/index.js";
import type {
  MemoryWriteStore,
  StoreCommitResult,
} from "../../modules/reflection/index.js";
import { bootstrapFalkorDbSchema } from "./falkordb-schema.js";
import type {
  EmbeddingModelIdentity,
  IndexedSearchDocument,
  PreparedSearchIndex,
  SearchEntityType,
} from "../../modules/retrieval/index.js";

interface SnapshotRow {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly repositoryUri: string | null;
  readonly revision: number;
  readonly conceptIds: string[];
  readonly claimIds: string[];
  readonly evidenceIds: string[];
  readonly contextIds: string[];
}

interface RevisionRow {
  readonly projectRevision: number;
}

interface CurrentRevisionRow {
  readonly actualRevision: number;
}

interface CurrentIndexRow {
  readonly provider: "ollama";
  readonly model: string;
  readonly digest: string;
  readonly dimension: number;
}

const LOAD_SNAPSHOT = `
MATCH (project:Project {id: $projectId})
OPTIONAL MATCH (concept:Concept {projectId: $projectId})
WITH project, collect(concept.id) AS conceptIds
OPTIONAL MATCH (claim:Claim {projectId: $projectId})
WITH project, conceptIds, collect(claim.id) AS claimIds
OPTIONAL MATCH (evidence:Evidence {projectId: $projectId})
WITH project, conceptIds, claimIds, collect(evidence.id) AS evidenceIds
OPTIONAL MATCH (context:Context {projectId: $projectId})
RETURN project.id AS projectId,
       project.name AS name,
       project.description AS description,
       project.repositoryUri AS repositoryUri,
       project.revision AS revision,
       conceptIds,
       claimIds,
       evidenceIds,
       collect(context.id) AS contextIds
`;

const COMMIT_CREATE_DELTA = `
MATCH (project:Project {id: $projectId, revision: $expectedRevision})
MERGE (embeddingIndex:EmbeddingIndex {id: 'primary'})
ON CREATE SET embeddingIndex.provider = $indexIdentity.provider,
              embeddingIndex.model = $indexIdentity.model,
              embeddingIndex.digest = $indexIdentity.digest,
              embeddingIndex.dimension = $indexIdentity.dimension,
              embeddingIndex.updatedAt = $indexedAt,
              embeddingIndex.schemaVersion = 1
WITH project, embeddingIndex
WHERE embeddingIndex.provider = $indexIdentity.provider
  AND embeddingIndex.model = $indexIdentity.model
  AND embeddingIndex.digest = $indexIdentity.digest
  AND embeddingIndex.dimension = $indexIdentity.dimension
SET project.revision = project.revision + 1
CREATE (event:ReflectionEvent {
  id: $event.id,
  projectId: $projectId,
  trigger: $event.trigger,
  createdAt: $event.createdAt,
  metadataJson: $event.metadataJson,
  operationsJson: $event.operationsJson,
  schemaVersion: 1
})
CREATE (event)-[:IN_PROJECT]->(project)
WITH project, event
CALL {
  WITH project, event
  UNWIND $concepts AS item
  CREATE (concept:Concept {
    id: item.id,
    projectId: $projectId,
    canonicalName: item.canonicalName,
    description: item.description,
    conceptType: item.conceptType,
    aliases: item.aliases,
    embedding: vecf32(item.embedding),
    embeddingText: item.embeddingText,
    embeddingProvider: $indexIdentity.provider,
    embeddingModel: $indexIdentity.model,
    embeddingDigest: $indexIdentity.digest,
    embeddingDimension: $indexIdentity.dimension,
    embeddingUpdatedAt: $indexedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    schemaVersion: 1
  })
  CREATE (project)-[:HAS_CONCEPT]->(concept)
  CREATE (event)-[:CREATED]->(concept)
}
WITH project, event
CALL {
  WITH project, event
  UNWIND $evidence AS item
  CREATE (evidence:Evidence {
    id: item.id,
    projectId: $projectId,
    type: item.type,
    summary: item.summary,
    content: item.content,
    sourceUri: item.sourceUri,
    repo: item.repo,
    commit: item.commit,
    branch: item.branch,
    file: item.file,
    symbol: item.symbol,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    command: item.command,
    result: item.result,
    quote: item.quote,
    observedAt: item.observedAt,
    retrievedAt: item.retrievedAt,
    contentHash: item.contentHash,
    embedding: vecf32(item.embedding),
    embeddingText: item.embeddingText,
    embeddingProvider: $indexIdentity.provider,
    embeddingModel: $indexIdentity.model,
    embeddingDigest: $indexIdentity.digest,
    embeddingDimension: $indexIdentity.dimension,
    embeddingUpdatedAt: $indexedAt,
    createdAt: item.createdAt,
    schemaVersion: 1
  })
  CREATE (event)-[:CREATED]->(evidence)
}
WITH project, event
CALL {
  WITH project, event
  UNWIND $contexts AS item
  CREATE (context:Context {
    id: item.id,
    projectId: $projectId,
    name: item.name,
    description: item.description,
    dimensionsJson: item.dimensionsJson,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    schemaVersion: 1
  })
  CREATE (event)-[:CREATED]->(context)
}
WITH project, event
CALL {
  WITH project, event
  UNWIND $claims AS item
  MATCH (subject:Concept {projectId: $projectId, id: item.subjectId})
  OPTIONAL MATCH (object:Concept {projectId: $projectId, id: item.objectId})
  CREATE (claim:Claim {
    id: item.id,
    projectId: $projectId,
    predicate: item.predicate,
    statement: item.statement,
    epistemicBasis: item.epistemicBasis,
    confidenceLevel: item.confidenceLevel,
    lifecycleStatus: item.lifecycleStatus,
    validFrom: item.validFrom,
    validTo: item.validTo,
    lastVerifiedAt: item.lastVerifiedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    provenanceJson: item.provenanceJson,
    embedding: vecf32(item.embedding),
    embeddingText: item.embeddingText,
    embeddingProvider: $indexIdentity.provider,
    embeddingModel: $indexIdentity.model,
    embeddingDigest: $indexIdentity.digest,
    embeddingDimension: $indexIdentity.dimension,
    embeddingUpdatedAt: $indexedAt,
    schemaVersion: 1,
    revision: 1
  })
  CREATE (project)-[:HAS_CLAIM]->(claim)
  CREATE (event)-[:CREATED]->(claim)
  CREATE (claim)-[:SUBJECT]->(subject)
  FOREACH (_ IN CASE WHEN object IS NULL THEN [] ELSE [1] END |
    CREATE (claim)-[:OBJECT]->(object)
  )
}
WITH project, event
CALL {
  WITH project
  UNWIND $claimEvidenceEdges AS edge
  MATCH (claim:Claim {projectId: $projectId, id: edge.from})
  MATCH (evidence:Evidence {projectId: $projectId, id: edge.to})
  CREATE (claim)-[:SUPPORTED_BY]->(evidence)
}
WITH project, event
CALL {
  WITH project
  UNWIND $claimContextEdges AS edge
  MATCH (claim:Claim {projectId: $projectId, id: edge.from})
  MATCH (context:Context {projectId: $projectId, id: edge.to})
  CREATE (claim)-[:APPLIES_IN]->(context)
}
WITH project, event
CALL {
  WITH project
  UNWIND $contextConceptEdges AS edge
  MATCH (context:Context {projectId: $projectId, id: edge.from})
  MATCH (concept:Concept {projectId: $projectId, id: edge.to})
  CREATE (context)-[:DIMENSION_CONCEPT]->(concept)
}
WITH project, event
CALL {
  WITH project
  UNWIND $supportsEdges AS edge
  MATCH (source:Claim {projectId: $projectId, id: edge.from})
  MATCH (target:Claim {projectId: $projectId, id: edge.to})
  CREATE (source)-[:SUPPORTS]->(target)
}
WITH project, event
CALL {
  WITH project
  UNWIND $contradictsEdges AS edge
  MATCH (source:Claim {projectId: $projectId, id: edge.from})
  MATCH (target:Claim {projectId: $projectId, id: edge.to})
  CREATE (source)-[:CONTRADICTS]->(target)
}
WITH project, event
CALL {
  WITH project
  UNWIND $supersedesEdges AS edge
  MATCH (source:Claim {projectId: $projectId, id: edge.from})
  MATCH (target:Claim {projectId: $projectId, id: edge.to})
  CREATE (source)-[:SUPERSEDES]->(target)
}
WITH project, event
CALL {
  WITH project
  UNWIND $refinesEdges AS edge
  MATCH (source:Claim {projectId: $projectId, id: edge.from})
  MATCH (target:Claim {projectId: $projectId, id: edge.to})
  CREATE (source)-[:REFINES]->(target)
}
WITH project, event
CALL {
  WITH project
  UNWIND $derivedFromEdges AS edge
  MATCH (source:Claim {projectId: $projectId, id: edge.from})
  MATCH (target:Claim {projectId: $projectId, id: edge.to})
  CREATE (source)-[:DERIVED_FROM]->(target)
}
RETURN project.revision AS projectRevision
`;

function edges<T extends { readonly id: string }>(
  items: readonly T[],
  selectTargets: (item: T) => readonly string[],
) {
  return items.flatMap((item) =>
    selectTargets(item).map((target) => ({ from: item.id, to: target })),
  );
}

function searchDocumentMap(
  documents: readonly IndexedSearchDocument[],
): ReadonlyMap<string, IndexedSearchDocument> {
  return new Map(
    documents.map((document) => [
      `${document.entityType}:${document.entityId}`,
      document,
    ]),
  );
}

function requireSearchDocument(
  documents: ReadonlyMap<string, IndexedSearchDocument>,
  entityType: SearchEntityType,
  entityId: string,
): IndexedSearchDocument {
  const document = documents.get(`${entityType}:${entityId}`);
  if (document === undefined) {
    throw new Error(`Missing search document for ${entityType} '${entityId}'.`);
  }
  return document;
}

interface ProjectRegistrationRow {
  readonly created: boolean;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly repositoryUri: string | null;
  readonly revision: number;
}

interface ProjectOverviewRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly repositoryUri: string | null;
  readonly revision: number;
  readonly concepts: number;
  readonly claims: number;
  readonly evidence: number;
  readonly contexts: number;
  readonly reflectionEvents: number;
}

export class FalkorDbMemoryStore implements MemoryWriteStore, ProjectRegistrationStore, ProjectCatalogStore {
  readonly #db: FalkorDB;
  readonly #graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.#db = db;
    this.#graph = db.selectGraph(graphName);
  }

  static async connect(options: {
    readonly url: string;
    readonly graphName?: string;
  }): Promise<FalkorDbMemoryStore> {
    const db = await FalkorDB.connect({ url: options.url });
    return new FalkorDbMemoryStore(db, options.graphName ?? "memoryos");
  }

  async close(): Promise<void> {
    await this.#db.close();
  }

  async bootstrap(options: { readonly embeddingDimension: number }): Promise<void> {
    await bootstrapFalkorDbSchema(this.#graph, options);
  }

  async registerProject(project: Project): Promise<{ readonly created: boolean; readonly project: Project }> {
    const registrationToken = randomUUID();
    const result = await this.#graph.query<ProjectRegistrationRow>(
      `MERGE (project:Project {id: $id})
       ON CREATE SET project.name = $name,
                     project.description = $description,
                     project.repositoryUri = $repositoryUri,
                     project.revision = $revision,
                     project.schemaVersion = 1,
                     project.registrationToken = $registrationToken
       WITH project, coalesce(project.registrationToken = $registrationToken, false) AS created
       REMOVE project.registrationToken
       RETURN created, project.id AS id, project.name AS name,
              project.description AS description, project.repositoryUri AS repositoryUri,
              project.revision AS revision`,
      {
        params: {
          id: project.id,
          name: project.name,
          description: project.description,
          repositoryUri: project.repositoryUri,
          revision: project.revision,
          registrationToken,
        },
      },
    );
    const row = result.data?.[0];
    if (row === undefined) throw new Error("FalkorDB did not return the registered project.");
    return {
      created: row.created,
      project: {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        repositoryUri: row.repositoryUri ?? null,
        revision: row.revision,
        schemaVersion: 1,
      },
    };
  }

  async listProjectOverviews(): Promise<readonly ProjectOverview[]> {
    const result = await this.#graph.roQuery<ProjectOverviewRow>(`
      MATCH (project:Project)
      OPTIONAL MATCH (concept:Concept {projectId: project.id})
      WITH project, count(concept) AS concepts
      OPTIONAL MATCH (claim:Claim {projectId: project.id})
      WITH project, concepts, count(claim) AS claims
      OPTIONAL MATCH (evidence:Evidence {projectId: project.id})
      WITH project, concepts, claims, count(evidence) AS evidence
      OPTIONAL MATCH (context:Context {projectId: project.id})
      WITH project, concepts, claims, evidence, count(context) AS contexts
      OPTIONAL MATCH (event:ReflectionEvent {projectId: project.id})
      RETURN project.id AS id, project.name AS name,
             project.description AS description, project.repositoryUri AS repositoryUri,
             project.revision AS revision, concepts, claims, evidence, contexts,
             count(event) AS reflectionEvents
      ORDER BY toLower(project.name), project.id
    `);
    return (result.data ?? []).map((row) => ({
      project: {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        repositoryUri: row.repositoryUri ?? null,
        revision: row.revision,
        schemaVersion: 1,
      },
      counts: {
        concepts: row.concepts,
        claims: row.claims,
        evidence: row.evidence,
        contexts: row.contexts,
        reflectionEvents: row.reflectionEvents,
      },
    }));
  }

  async loadProjectSnapshot(projectId: ProjectId): Promise<ProjectSnapshot | null> {
    const result = await this.#graph.query<SnapshotRow>(LOAD_SNAPSHOT, {
      params: { projectId },
    });
    const row = result.data?.[0];
    if (row === undefined) {
      return null;
    }

    return {
      project: {
        id: row.projectId,
        name: row.name,
        description: row.description ?? null,
        repositoryUri: row.repositoryUri ?? null,
        revision: row.revision,
        schemaVersion: 1,
      },
      conceptIds: new Set(row.conceptIds),
      claimIds: new Set(row.claimIds),
      evidenceIds: new Set(row.evidenceIds),
      contextIds: new Set(row.contextIds),
    };
  }

  async commitPreparedDelta(
    delta: PreparedMemoryDelta,
    searchIndex: PreparedSearchIndex,
  ): Promise<StoreCommitResult> {
    const documents = searchDocumentMap(searchIndex.documents);
    const result = await this.#graph.query<RevisionRow>(COMMIT_CREATE_DELTA, {
      params: {
        projectId: delta.projectId,
        expectedRevision: delta.expectedRevision,
        indexIdentity: { ...searchIndex.identity },
        indexedAt: searchIndex.indexedAt,
        event: {
          id: delta.reflectionEvent.id,
          trigger: delta.reflectionEvent.metadata.trigger,
          createdAt: delta.reflectionEvent.createdAt,
          metadataJson: JSON.stringify(delta.reflectionEvent.metadata),
          operationsJson: JSON.stringify(delta.reflectionEvent.operations),
        },
        concepts: delta.concepts.map((item) => ({
          ...(() => {
            const document = requireSearchDocument(documents, "concept", item.id);
            return { embedding: [...document.vector], embeddingText: document.text };
          })(),
          id: item.id,
          canonicalName: item.canonicalName,
          description: item.description,
          conceptType: item.conceptType,
          aliases: [...item.aliases],
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        evidence: delta.evidence.map((item) => ({
          ...(() => {
            const document = requireSearchDocument(documents, "evidence", item.id);
            return { embedding: [...document.vector], embeddingText: document.text };
          })(),
          id: item.id,
          type: item.type,
          summary: item.summary,
          content: item.content,
          sourceUri: item.sourceUri,
          repo: item.repo,
          commit: item.commit,
          branch: item.branch,
          file: item.file,
          symbol: item.symbol,
          lineStart: item.lineStart,
          lineEnd: item.lineEnd,
          command: item.command,
          result: item.result,
          quote: item.quote,
          observedAt: item.observedAt,
          retrievedAt: item.retrievedAt,
          contentHash: item.contentHash,
          createdAt: item.createdAt,
        })),
        contexts: delta.contexts.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          dimensionsJson: JSON.stringify(item.dimensions),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        claims: delta.claims.map((item) => ({
          ...(() => {
            const document = requireSearchDocument(documents, "claim", item.id);
            return { embedding: [...document.vector], embeddingText: document.text };
          })(),
          id: item.id,
          subjectId: item.subjectId,
          objectId: item.objectId,
          predicate: item.predicate,
          statement: item.statement,
          epistemicBasis: item.epistemicBasis,
          confidenceLevel: item.confidenceLevel,
          lifecycleStatus: item.lifecycleStatus,
          validFrom: item.validFrom,
          validTo: item.validTo,
          lastVerifiedAt: item.lastVerifiedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          provenanceJson: JSON.stringify(item.provenance),
        })),
        claimEvidenceEdges: edges(delta.claims, (item) => item.evidenceIds),
        claimContextEdges: edges(delta.claims, (item) => item.contextIds),
        contextConceptEdges: edges(delta.contexts, (item) => item.conceptIds),
        supportsEdges: edges(delta.claims, (item) => item.supports),
        contradictsEdges: edges(delta.claims, (item) => item.contradicts),
        supersedesEdges: edges(delta.claims, (item) => item.supersedes),
        refinesEdges: edges(delta.claims, (item) => item.refines),
        derivedFromEdges: edges(delta.claims, (item) => item.derivedFrom),
      },
    });
    const committed = result.data?.[0];
    if (committed !== undefined) {
      return { ok: true, projectRevision: committed.projectRevision };
    }

    const current = await this.#graph.roQuery<CurrentRevisionRow>(
      `MATCH (project:Project {id: $projectId})
       RETURN project.revision AS actualRevision`,
      { params: { projectId: delta.projectId } },
    );
    const actualRevision = current.data?.[0]?.actualRevision ?? -1;
    if (actualRevision !== delta.expectedRevision) {
      return { ok: false, code: "MEMORY_CONFLICT", actualRevision };
    }

    const currentIndex = await this.#graph.roQuery<CurrentIndexRow>(
      `MATCH (index:EmbeddingIndex {id: 'primary'})
       RETURN index.provider AS provider,
              index.model AS model,
              index.digest AS digest,
              index.dimension AS dimension`,
    );
    const identity = currentIndex.data?.[0];
    if (identity === undefined) {
      throw new Error("Embedding index identity disappeared during commit.");
    }
    return {
      ok: false,
      code: "INDEX_IDENTITY_MISMATCH",
      actualIdentity: identity satisfies EmbeddingModelIdentity,
    };
  }
}
