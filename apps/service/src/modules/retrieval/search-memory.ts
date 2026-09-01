import { reciprocalRankFusion } from "./ranking.js";
import { rankClaims } from "./claim-ranking.js";
import type { EmbeddingProvider, RetrievalStore } from "./ports.js";
import type {
  RetrievalFilter,
  SearchInclude,
  SearchMemoryQuery,
  SearchMemoryResult,
  SearchTime,
} from "./types.js";

const DEFAULT_INCLUDE: SearchInclude = {
  active: true,
  disputed: false,
  historical: false,
  superseded: false,
  invalidated: false,
};

const DEFAULT_TIME: SearchTime = { at: null, from: null, to: null };

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function graphDepthValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError("graphDepth must be an integer between 0 and 3.");
  }
  return value;
}

function normalizeFilter(query: SearchMemoryQuery): RetrievalFilter {
  const inputTime = { ...DEFAULT_TIME, ...query.time };
  for (const [name, value] of Object.entries(inputTime)) {
    if (value !== null && Number.isNaN(Date.parse(value))) {
      throw new RangeError(`time.${name} must be an ISO datetime or null.`);
    }
  }
  const time: SearchTime = {
    at: inputTime.at === null ? null : new Date(inputTime.at).toISOString(),
    from: inputTime.from === null ? null : new Date(inputTime.from).toISOString(),
    to: inputTime.to === null ? null : new Date(inputTime.to).toISOString(),
  };
  if (time.from !== null && time.to !== null && time.from > time.to) {
    throw new RangeError("time.from must not be later than time.to.");
  }
  return {
    include: { ...DEFAULT_INCLUDE, ...query.include },
    time,
  };
}

export function createSearchMemory(dependencies: {
  readonly embeddings: EmbeddingProvider;
  readonly store: RetrievalStore;
}) {
  return async function searchMemory(
    query: SearchMemoryQuery,
  ): Promise<SearchMemoryResult> {
    const text = query.query.trim();
    if (text.length === 0) {
      throw new RangeError("Search query must not be empty.");
    }
    const maxResults = positiveInteger(query.maxResults ?? 20, "maxResults", 100);
    const graphDepth = graphDepthValue(query.graphDepth ?? 1);
    const candidateLimit = Math.min(maxResults * 3, 300);
    const filter = normalizeFilter(query);
    const embedding = await dependencies.embeddings.embed([text]);
    const vector = embedding.vectors[0];
    if (vector === undefined) {
      throw new Error("Embedding provider returned no query vector.");
    }

    const [semantic, fullText] = await Promise.all([
      dependencies.store.searchSemantic({
        projectId: query.projectId,
        vector,
        identity: embedding.identity,
        filter,
        limit: candidateLimit,
      }),
      dependencies.store.searchFullText({
        projectId: query.projectId,
        query: text,
        filter,
        limit: candidateLimit,
      }),
    ]);
    const entryPoints = reciprocalRankFusion(
      [
        { channel: "semantic", results: semantic },
        { channel: "full_text", results: fullText },
      ],
      { maxResults: candidateLimit },
    );
    const subgraph = await dependencies.store.loadConnectedSubgraph({
      projectId: query.projectId,
      entryPoints,
      filter,
      graphDepth,
    });
    const fused = reciprocalRankFusion(
      [
        { channel: "semantic", results: semantic },
        { channel: "full_text", results: fullText },
        { channel: "graph", results: subgraph.graphClaimRanking },
      ],
      { maxResults: candidateLimit },
    );

    return {
      query: text,
      projectId: query.projectId,
      entryPoints: entryPoints.slice(0, maxResults),
      claims: rankClaims(
        subgraph.claims,
        fused,
        subgraph.contexts,
        query.context ?? null,
        maxResults,
      ),
      concepts: subgraph.concepts,
      evidence: subgraph.evidence,
      contexts: subgraph.contexts,
      edges: subgraph.edges,
      rankingMetadata: {
        algorithm: "RRF",
        channels: ["semantic", "full_text", "graph"],
        embeddingDigest: embedding.identity.digest,
        graphDepth,
      },
    };
  };
}
