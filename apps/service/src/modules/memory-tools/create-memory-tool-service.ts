import type { ApplyMemoryDeltaCommand } from "../knowledge/index.js";
import type { ApplyMemoryDeltaResult } from "../reflection/index.js";
import type { SearchMemoryQuery, SearchMemoryResult } from "../retrieval/index.js";
import type {
  AgentContextResult,
  ConflictCandidateInput,
  GetContextInput,
  HistoryInput,
  MemoryReadStore,
  MemoryToolService,
  SearchToolResult,
  SearchToolInput,
} from "./types.js";
import type { PotentialConflict } from "./types.js";

const DEFAULT_CONTEXT_BUDGET = 4_000;
const MIN_CONTEXT_BUDGET = 256;
const MAX_CONTEXT_BUDGET = 32_000;

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  const selected = Number.isFinite(value) ? value : fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new RangeError(`Value must be an integer between ${minimum} and ${maximum}.`);
  }
  return selected;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function overlap(left: readonly string[], right: readonly string[]): string[] {
  return left.filter((value) => right.includes(value));
}

function temporalOverlap(
  leftFrom: string | null,
  leftTo: string | null,
  rightFrom: string | null,
  rightTo: string | null,
): boolean {
  const instant = (value: string | null) => value === null ? null : Date.parse(value);
  const leftStart = instant(leftFrom);
  const leftEnd = instant(leftTo);
  const rightStart = instant(rightFrom);
  const rightEnd = instant(rightTo);
  return (leftEnd === null || rightStart === null || rightStart < leftEnd)
    && (rightEnd === null || leftStart === null || leftStart < rightEnd);
}

function compactContext(
  result: SearchToolResult,
  input: GetContextInput,
  tokenBudget: number,
): AgentContextResult {
  const claims = [...result.claims];
  const selectedClaims: typeof claims = [];
  const taskDescription = input.taskDescription.trim().slice(0, tokenBudget * 2);
  const build = (selected: typeof claims): Omit<AgentContextResult, "estimatedTokens" | "truncated"> => {
    const evidenceIds = new Set(selected.flatMap((claim) => claim.evidenceIds));
    const contextIds = new Set(selected.flatMap((claim) => claim.contextIds));
    const conceptIds = new Set(selected.flatMap((claim) =>
      [claim.subjectId, claim.objectId].filter((id): id is string => id !== null)));
    const claimIds = new Set(selected.map((claim) => claim.id));
    return {
      projectId: input.projectId,
      projectRevision: result.projectRevision,
      taskDescription,
      claims: selected,
      concepts: result.concepts.filter((item) => conceptIds.has(item.id)),
      evidence: result.evidence.filter((item) => evidenceIds.has(item.id)),
      contexts: result.contexts.filter((item) => contextIds.has(item.id)),
      edges: result.edges.filter((edge) => claimIds.has(edge.from) || claimIds.has(edge.to)),
      tokenBudget,
    };
  };

  for (const claim of claims) {
    const candidate = [...selectedClaims, claim];
    if (estimateTokens(build(candidate)) > tokenBudget) break;
    selectedClaims.push(claim);
  }

  const context = build(selectedClaims);
  return {
    ...context,
    estimatedTokens: estimateTokens(context),
    truncated: selectedClaims.length < claims.length,
  };
}

export function createMemoryToolService(dependencies: {
  readonly searchMemory: (query: SearchMemoryQuery) => Promise<SearchMemoryResult>;
  readonly applyMemoryDelta: (command: ApplyMemoryDeltaCommand) => Promise<ApplyMemoryDeltaResult>;
  readonly reads: MemoryReadStore;
}): MemoryToolService {
  const search = async (input: SearchToolInput): Promise<SearchToolResult> => {
    const [result, projectRevision] = await Promise.all([
      dependencies.searchMemory({
        projectId: input.projectId,
        query: input.query,
        ...(input.context === undefined ? {} : { context: input.context }),
        ...(input.include === undefined ? {} : { include: input.include }),
        ...(input.time === undefined ? {} : { time: input.time }),
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.graphDepth === undefined ? {} : { graphDepth: input.graphDepth }),
      }),
      dependencies.reads.getProjectRevision(input.projectId),
    ]);
    if (projectRevision === null) {
      throw new RangeError(`Project '${input.projectId}' does not exist.`);
    }
    return { ...result, projectRevision };
  };

  return {
    search,

    async getContext(input) {
      const tokenBudget = boundedInteger(
        input.tokenBudget ?? DEFAULT_CONTEXT_BUDGET,
        DEFAULT_CONTEXT_BUDGET,
        MIN_CONTEXT_BUDGET,
        MAX_CONTEXT_BUDGET,
      );
      const result = await search({
        projectId: input.projectId,
        query: input.taskDescription,
        ...(input.currentContext === undefined ? {} : { context: input.currentContext }),
        include: { active: true, disputed: true, historical: true },
        maxResults: Math.min(50, Math.max(5, Math.floor(tokenBudget / 200))),
        graphDepth: 2,
      });
      return compactContext(result, input, tokenBudget);
    },

    async findConcepts(input) {
      const limit = boundedInteger(input.limit ?? 10, 10, 1, 100);
      const result = await search({
        projectId: input.projectId,
        query: input.query,
        maxResults: limit,
        graphDepth: 0,
      });
      const scores = new Map(
        result.entryPoints
          .filter((item) => item.entityType === "concept")
          .map((item) => [item.entityId, item.score]),
      );
      return {
        concepts: result.concepts
          .map((concept) => ({
            id: concept.id,
            canonicalName: concept.canonicalName,
            aliases: concept.aliases,
            conceptType: concept.conceptType,
            similarity: scores.get(concept.id) ?? 0,
          }))
          .sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id))
          .slice(0, limit),
      };
    },

    getClaim: (input) => dependencies.reads.getClaim(input.projectId, input.claimId),
    explainClaim: (input) => dependencies.reads.explainClaim(input.projectId, input.claimId),

    async findConflicts(input: ConflictCandidateInput) {
      const [structural, semantic] = await Promise.all([
        dependencies.reads.findConflicts(input),
        dependencies.searchMemory({
          projectId: input.projectId,
          query: input.statement,
          include: {
            active: true, disputed: true, historical: true,
            superseded: true, invalidated: true,
          },
          maxResults: 50,
          graphDepth: 0,
        }),
      ]);
      const byId = new Map(structural.map((candidate) => [candidate.claimId, candidate]));
      const claimById = new Map(semantic.claims.map((claim) => [claim.id, claim]));
      const evidenceById = new Map(semantic.evidence.map((item) => [item.id, item]));
      const semanticRefs = semantic.entryPoints.filter((entry) => entry.entityType === "claim");
      const maxScore = Math.max(...semanticRefs.map((entry) => entry.score), 1);
      for (const reference of semanticRefs) {
        if (byId.has(reference.entityId)) continue;
        const claim = claimById.get(reference.entityId);
        if (claim === undefined) continue;
        const candidate: PotentialConflict = {
          claimId: claim.id,
          similarity: reference.score / maxScore,
          conflictReason: "semantic_similarity",
          contextOverlap: overlap(claim.contextIds, input.contextIds),
          temporalOverlap: temporalOverlap(
            input.validFrom, input.validTo, claim.validFrom, claim.validTo,
          ),
          evidenceSummary: claim.evidenceIds
            .map((id) => evidenceById.get(id)?.summary)
            .filter((summary): summary is string => summary !== undefined),
        };
        byId.set(candidate.claimId, candidate);
      }
      return {
        potentialConflicts: [...byId.values()].sort(
          (left, right) => right.similarity - left.similarity || left.claimId.localeCompare(right.claimId),
        ),
      };
    },

    applyDelta: (input) => dependencies.applyMemoryDelta(input),

    async history(input: HistoryInput) {
      return { events: await dependencies.reads.history(input) };
    },
  };
}
