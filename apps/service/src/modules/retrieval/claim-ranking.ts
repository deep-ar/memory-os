import type { FusedReference } from "./ranking.js";
import type {
  RankedClaim,
  RetrievedClaim,
  RetrievedContext,
  SearchContext,
} from "./types.js";

const CONFIDENCE_MULTIPLIER = {
  established: 1.35,
  verified: 1.25,
  supported: 1.15,
  tentative: 1,
} as const;

const LIFECYCLE_MULTIPLIER = {
  active: 1,
  disputed: 0.8,
  historical: 0.65,
  superseded: 0.5,
  invalidated: 0.3,
} as const;

function contextMultiplier(
  claim: RetrievedClaim,
  contexts: ReadonlyMap<string, RetrievedContext>,
  requested: SearchContext | null,
): number {
  if (requested === null) {
    return 1;
  }

  const requestedEntries = Object.entries(requested).flatMap(([key, value]) =>
    typeof value === "string" && value.length > 0
      ? [[key, value] as const]
      : [],
  );
  if (requestedEntries.length === 0 || claim.contextIds.length === 0) {
    return 1;
  }

  let best = 0.85;
  for (const contextId of claim.contextIds) {
    const context = contexts.get(contextId);
    if (context === undefined) {
      continue;
    }
    let multiplier = 1;
    for (const [key, requestedValue] of requestedEntries) {
      const actual = context.dimensions[key as keyof typeof context.dimensions];
      if (actual === null) {
        continue;
      }
      multiplier += actual.toLowerCase() === requestedValue.toLowerCase() ? 0.08 : -0.04;
    }
    best = Math.max(best, multiplier);
  }
  return best;
}

export function rankClaims(
  claims: readonly RetrievedClaim[],
  fused: readonly FusedReference[],
  contexts: readonly RetrievedContext[],
  requestedContext: SearchContext | null,
  maxResults: number,
): readonly RankedClaim[] {
  const retrievalScores = new Map(
    fused
      .filter((reference) => reference.entityType === "claim")
      .map((reference) => [reference.entityId, reference.score]),
  );
  const contextsById = new Map(contexts.map((context) => [context.id, context]));

  return claims
    .map((claim) => {
      const retrievalScore = retrievalScores.get(claim.id) ?? 0;
      const policyMultiplier =
        CONFIDENCE_MULTIPLIER[claim.confidenceLevel] *
        LIFECYCLE_MULTIPLIER[claim.lifecycleStatus] *
        contextMultiplier(claim, contextsById, requestedContext);
      return {
        ...claim,
        retrievalScore,
        policyMultiplier,
        score: retrievalScore * policyMultiplier,
      };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, maxResults);
}
