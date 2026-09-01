import type {
  PreparedMemoryDelta,
  StoredClaim,
  StoredConcept,
  StoredEvidence,
} from "../knowledge/index.js";
import type {
  EmbeddingModelIdentity,
  EmbeddingProvider,
} from "./ports.js";
import { EmbeddingFailure } from "./embedding-errors.js";

export type SearchEntityType = "concept" | "claim" | "evidence";

export interface SearchDocument {
  readonly projectId: string;
  readonly entityId: string;
  readonly entityType: SearchEntityType;
  readonly text: string;
}

export interface IndexedSearchDocument extends SearchDocument {
  readonly vector: readonly number[];
}

export interface PreparedSearchIndex {
  readonly identity: EmbeddingModelIdentity;
  readonly documents: readonly IndexedSearchDocument[];
  readonly indexedAt: string;
}

function compactLines(lines: readonly (string | null)[]): string {
  return lines
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0)
    .join("\n");
}

export function searchTextForConcept(
  concept: Pick<StoredConcept, "canonicalName" | "aliases" | "description" | "conceptType">,
): string {
  return compactLines([
    concept.canonicalName,
    concept.aliases.join(" "),
    concept.description,
    concept.conceptType,
  ]);
}

export function searchTextForClaim(
  claim: Pick<StoredClaim, "subjectId" | "predicate" | "objectId" | "statement" | "contextIds">,
): string {
  return compactLines([
    `subject: ${claim.subjectId}`,
    `predicate: ${claim.predicate}`,
    claim.objectId === null ? null : `object: ${claim.objectId}`,
    claim.statement,
    claim.contextIds.length === 0
      ? null
      : `contexts: ${claim.contextIds.join(" ")}`,
  ]);
}

export function searchTextForEvidence(
  evidence: Pick<
    StoredEvidence,
    "summary" | "content" | "quote" | "file" | "symbol" | "command" | "result"
  >,
): string {
  return compactLines([
    evidence.summary,
    evidence.content,
    evidence.quote,
    evidence.file,
    evidence.symbol,
    evidence.command,
    evidence.result,
  ]);
}

function conceptDocument(concept: StoredConcept): SearchDocument {
  return {
    projectId: concept.projectId,
    entityId: concept.id,
    entityType: "concept",
    text: searchTextForConcept(concept),
  };
}

function claimDocument(claim: StoredClaim): SearchDocument {
  return {
    projectId: claim.projectId,
    entityId: claim.id,
    entityType: "claim",
    text: searchTextForClaim(claim),
  };
}

function evidenceDocument(evidence: StoredEvidence): SearchDocument {
  return {
    projectId: evidence.projectId,
    entityId: evidence.id,
    entityType: "evidence",
    text: searchTextForEvidence(evidence),
  };
}

export function createSearchDocuments(
  delta: PreparedMemoryDelta,
): readonly SearchDocument[] {
  return [
    ...delta.concepts.map(conceptDocument),
    ...delta.claims.map(claimDocument),
    ...delta.evidence.map(evidenceDocument),
  ];
}

export async function prepareSearchIndex(
  delta: PreparedMemoryDelta,
  provider: EmbeddingProvider,
): Promise<PreparedSearchIndex> {
  const documents = createSearchDocuments(delta);
  const batch = await provider.embed(documents.map((document) => document.text));
  if (batch.vectors.length !== documents.length) {
    throw new EmbeddingFailure(
      "INVALID_RESPONSE",
      "Embedding provider returned an incomplete document batch.",
    );
  }

  return {
    identity: batch.identity,
    documents: documents.map((document, index) => ({
      ...document,
      vector: batch.vectors[index]!,
    })),
    indexedAt: delta.reflectionEvent.createdAt,
  };
}
