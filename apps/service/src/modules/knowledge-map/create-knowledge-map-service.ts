import type {
  ClaimMapNode,
  ClaimRelationType,
  ConceptMapNode,
  ContextCatalogResult,
  ContextGraphInput,
  ContextGraphResult,
  ContextHealth,
  KnowledgeMapClaimRecord,
  KnowledgeMapClaimRelation,
  KnowledgeMapConceptRecord,
  KnowledgeMapEdge,
  KnowledgeMapPriority,
  KnowledgeMapReadStore,
  KnowledgeMapService,
} from "./types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;
const HISTORY_STATUSES = new Set(["historical", "superseded", "invalidated"]);
const BACKBONE_TYPES = /(^|[_\s-])(architecture|constraint|decision|policy|practice|problem|procedure|root[_\s-]?cause|strategy|workflow)($|[_\s-])/iu;
const PRIORITY_ORDER: Record<KnowledgeMapPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

function isHistorical(claim: KnowledgeMapClaimRecord): boolean {
  return HISTORY_STATUSES.has(claim.lifecycleStatus);
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function recentCutoff(claims: readonly KnowledgeMapClaimRecord[]): number {
  const newest = Math.max(...claims.map((claim) => Date.parse(claim.updatedAt)), 0);
  return newest - 7 * 24 * 60 * 60 * 1_000;
}

function claimFlags(
  claim: KnowledgeMapClaimRecord,
  relations: readonly KnowledgeMapClaimRelation[],
  cutoff: number,
  boundary: boolean,
): string[] {
  const flags: string[] = [];
  if (claim.lifecycleStatus === "disputed") flags.push("disputed");
  if (claim.confidenceLevel === "tentative") flags.push("tentative");
  if (claim.evidenceIds.length === 0) flags.push("without_evidence");
  if (claim.contextIds.length === 0) flags.push("unscoped");
  if (isHistorical(claim)) flags.push("historical");
  if (Date.parse(claim.updatedAt) >= cutoff) flags.push("recent");
  if (relations.some((relation) => relation.type === "CONTRADICTS"
    && (relation.sourceId === claim.id || relation.targetId === claim.id))) flags.push("contradiction");
  if (boundary) flags.push("boundary");
  return flags;
}

function claimPriority(
  claim: KnowledgeMapClaimRecord,
  flags: readonly string[],
  relations: readonly KnowledgeMapClaimRelation[],
  conceptsById: ReadonlyMap<string, KnowledgeMapConceptRecord>,
): KnowledgeMapPriority {
  if (isHistorical(claim)) return "P4";
  if (flags.some((flag) => ["disputed", "tentative", "without_evidence", "unscoped", "contradiction"].includes(flag))) {
    return "P0";
  }
  const hasClaimRelation = relations.some((relation) => relation.sourceId === claim.id || relation.targetId === claim.id);
  const subjectType = conceptsById.get(claim.subjectId)?.conceptType ?? "";
  const objectType = claim.objectId === null ? "" : conceptsById.get(claim.objectId)?.conceptType ?? "";
  if (hasClaimRelation || BACKBONE_TYPES.test(subjectType) || BACKBONE_TYPES.test(objectType)) return "P1";
  if (flags.includes("recent")) return "P2";
  return "P3";
}

function compareClaims(left: ClaimMapNode, right: ClaimMapNode): number {
  return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || right.localDegree - left.localDegree
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.id.localeCompare(right.id);
}

function claimDegree(claimId: string, relations: readonly KnowledgeMapClaimRelation[]): number {
  return relations.reduce(
    (count, relation) => count + Number(relation.sourceId === claimId || relation.targetId === claimId),
    0,
  );
}

function contextClaimSet(claims: readonly KnowledgeMapClaimRecord[], contextId: string): KnowledgeMapClaimRecord[] {
  return claims.filter((claim) => claim.contextIds.includes(contextId));
}

function conceptIdsForClaims(claims: readonly KnowledgeMapClaimRecord[], direct: readonly string[] = []): Set<string> {
  const ids = new Set(direct);
  for (const claim of claims) {
    ids.add(claim.subjectId);
    if (claim.objectId !== null) ids.add(claim.objectId);
  }
  return ids;
}

function catalogHealth(claims: readonly KnowledgeMapClaimRecord[], conceptCount: number) {
  return {
    claims: claims.length,
    concepts: conceptCount,
    active: claims.filter((claim) => claim.lifecycleStatus === "active").length,
    disputed: claims.filter((claim) => claim.lifecycleStatus === "disputed").length,
    tentative: claims.filter((claim) => claim.confidenceLevel === "tentative").length,
    withoutEvidence: claims.filter((claim) => claim.evidenceIds.length === 0).length,
    historical: claims.filter(isHistorical).length,
  };
}

function connectedComponents(nodes: readonly string[], edges: readonly KnowledgeMapEdge[]): number {
  if (nodes.length === 0) return 0;
  const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  let components = 0;
  const visited = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node)) continue;
    components += 1;
    const pending = [node];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) pending.push(next);
    }
  }
  return components;
}

function duplicateConceptCount(concepts: readonly KnowledgeMapConceptRecord[]): number {
  const counts = new Map<string, number>();
  for (const concept of concepts) {
    const names = new Set([concept.canonicalName, ...concept.aliases].map(normalizeName).filter(Boolean));
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const duplicateIds = new Set<string>();
  for (const concept of concepts) {
    const names = [concept.canonicalName, ...concept.aliases].map(normalizeName).filter(Boolean);
    if (names.some((name) => (counts.get(name) ?? 0) > 1)) duplicateIds.add(concept.id);
  }
  return duplicateIds.size;
}

export function createKnowledgeMapService(store: KnowledgeMapReadStore): KnowledgeMapService {
  return {
    async listContexts(projectId): Promise<ContextCatalogResult | null> {
      const source = await store.loadCatalog(projectId);
      if (source === null) return null;
      return {
        projectId,
        projectRevision: source.projectRevision,
        contexts: source.contexts.map((context) => {
          const claims = contextClaimSet(source.claims, context.id);
          return {
            id: context.id,
            name: context.name,
            description: context.description,
            dimensions: context.dimensions,
            health: catalogHealth(claims, conceptIdsForClaims(claims, context.conceptIds).size),
          };
        }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
        unscopedClaims: source.claims.filter((claim) => claim.contextIds.length === 0).length,
      };
    },

    async getContextGraph(input: ContextGraphInput): Promise<ContextGraphResult | null> {
      const limit = input.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
      }
      const includeBoundary = input.includeBoundary ?? true;
      const includeUnscoped = input.includeUnscoped ?? false;
      const includeHistory = input.includeHistory ?? false;
      const source = await store.loadContextGraph({
        projectId: input.projectId,
        contextId: input.contextId,
        includeUnscoped,
        includeBoundary,
      });
      if (source === null) return null;

      const conceptsById = new Map(source.concepts.map((concept) => [concept.id, concept]));
      const allScopedClaims = source.claims.filter((claim) =>
        claim.contextIds.includes(input.contextId) || (includeUnscoped && claim.contextIds.length === 0));
      const visiblePrimary = allScopedClaims.filter((claim) => includeHistory || !isHistorical(claim));
      const primaryIds = new Set(visiblePrimary.map((claim) => claim.id));
      const boundaryIds = new Set<string>();
      if (includeBoundary) {
        for (const relation of source.relations) {
          if (primaryIds.has(relation.sourceId) && !primaryIds.has(relation.targetId)) boundaryIds.add(relation.targetId);
          if (primaryIds.has(relation.targetId) && !primaryIds.has(relation.sourceId)) boundaryIds.add(relation.sourceId);
        }
      }
      const cutoff = recentCutoff(allScopedClaims);
      const toNode = (claim: KnowledgeMapClaimRecord, boundary: boolean): ClaimMapNode => {
        const flags = claimFlags(claim, source.relations, cutoff, boundary);
        return {
          ...claim,
          kind: "claim",
          priority: claimPriority(claim, flags, source.relations, conceptsById),
          flags,
          localDegree: claimDegree(claim.id, source.relations) + 1 + Number(claim.objectId !== null),
          boundary,
        };
      };
      const rankedPrimary = visiblePrimary.map((claim) => toNode(claim, false)).sort(compareClaims);
      const selectedPrimary = rankedPrimary.slice(0, limit);
      const selectedPrimaryIds = new Set(selectedPrimary.map((claim) => claim.id));
      const selectedBoundary = source.claims
        .filter((claim) => boundaryIds.has(claim.id) && (includeHistory || !isHistorical(claim)))
        .map((claim) => toNode(claim, true))
        .filter((claim) => source.relations.some((relation) =>
          (relation.sourceId === claim.id && selectedPrimaryIds.has(relation.targetId))
          || (relation.targetId === claim.id && selectedPrimaryIds.has(relation.sourceId))))
        .sort(compareClaims)
        .slice(0, Math.min(limit, 100));
      const selectedClaims = [...selectedPrimary, ...selectedBoundary];
      const selectedClaimIds = new Set(selectedClaims.map((claim) => claim.id));
      const selectedConceptIds = conceptIdsForClaims(selectedClaims, source.context.conceptIds);

      const edges: KnowledgeMapEdge[] = [];
      for (const claim of selectedClaims) {
        edges.push({
          id: `subject:${claim.subjectId}:${claim.id}`,
          source: claim.subjectId,
          target: claim.id,
          relation: "SUBJECT",
          kind: "structural",
          boundary: claim.boundary,
        });
        if (claim.objectId !== null) {
          edges.push({
            id: `object:${claim.id}:${claim.objectId}`,
            source: claim.id,
            target: claim.objectId,
            relation: "OBJECT",
            kind: "structural",
            boundary: claim.boundary,
          });
        }
      }
      for (const relation of source.relations) {
        if (!selectedClaimIds.has(relation.sourceId) || !selectedClaimIds.has(relation.targetId)) continue;
        edges.push({
          id: `${relation.type.toLocaleLowerCase()}:${relation.sourceId}:${relation.targetId}`,
          source: relation.sourceId,
          target: relation.targetId,
          relation: relation.type,
          kind: "claim_relation",
          boundary: selectedBoundary.some((claim) => claim.id === relation.sourceId || claim.id === relation.targetId),
        });
      }

      const incidentClaims = new Map<string, ClaimMapNode[]>();
      for (const claim of selectedClaims) {
        for (const id of [claim.subjectId, claim.objectId].filter((value): value is string => value !== null)) {
          const list = incidentClaims.get(id) ?? [];
          list.push(claim);
          incidentClaims.set(id, list);
        }
      }
      const conceptNodes: ConceptMapNode[] = source.concepts
        .filter((concept) => selectedConceptIds.has(concept.id))
        .map((concept) => {
          const incident = incidentClaims.get(concept.id) ?? [];
          const orphan = incident.length === 0;
          const priority = orphan ? "P0" : incident
            .map((claim) => claim.priority)
            .sort((left, right) => PRIORITY_ORDER[left] - PRIORITY_ORDER[right])[0] ?? "P3";
          return {
            ...concept,
            kind: "concept" as const,
            priority,
            flags: orphan ? ["orphan"] : [],
            localDegree: incident.length,
            boundary: incident.length > 0 && incident.every((claim) => claim.boundary),
          };
        })
        .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
          || right.localDegree - left.localDegree || left.id.localeCompare(right.id));

      const healthConceptIds = conceptIdsForClaims(allScopedClaims, source.context.conceptIds);
      const healthConcepts = source.concepts.filter((concept) => healthConceptIds.has(concept.id));
      const healthRelations = source.relations.filter((relation) =>
        allScopedClaims.some((claim) => claim.id === relation.sourceId)
        && allScopedClaims.some((claim) => claim.id === relation.targetId));
      const healthEdges: KnowledgeMapEdge[] = [];
      for (const claim of allScopedClaims) {
        healthEdges.push({ id: `health-subject:${claim.id}`, source: claim.subjectId, target: claim.id, relation: "SUBJECT", kind: "structural", boundary: false });
        if (claim.objectId !== null) healthEdges.push({ id: `health-object:${claim.id}`, source: claim.id, target: claim.objectId, relation: "OBJECT", kind: "structural", boundary: false });
      }
      for (const relation of healthRelations) {
        healthEdges.push({ id: `health-${relation.type}:${relation.sourceId}:${relation.targetId}`, source: relation.sourceId, target: relation.targetId, relation: relation.type, kind: "claim_relation", boundary: false });
      }
      const health: ContextHealth = {
        ...catalogHealth(allScopedClaims, healthConceptIds.size),
        relations: healthRelations.length,
        recent: allScopedClaims.filter((claim) => Date.parse(claim.updatedAt) >= cutoff).length,
        components: connectedComponents(
          [...allScopedClaims.map((claim) => claim.id), ...healthConceptIds],
          healthEdges,
        ),
        isolatedConcepts: source.context.conceptIds.filter((id) =>
          !allScopedClaims.some((claim) => claim.subjectId === id || claim.objectId === id)).length,
        probableDuplicateConcepts: duplicateConceptCount(healthConcepts),
      };

      return {
        projectId: input.projectId,
        projectRevision: source.projectRevision,
        context: source.context,
        options: { includeBoundary, includeUnscoped, includeHistory, limit },
        nodes: [...conceptNodes, ...selectedClaims],
        edges,
        health,
        totalPrimaryClaims: visiblePrimary.length,
        includedPrimaryClaims: selectedPrimary.length,
        truncated: selectedPrimary.length < visiblePrimary.length,
      };
    },
  };
}

export const knowledgeMapLimits = { default: DEFAULT_LIMIT, maximum: MAX_LIMIT } as const;
