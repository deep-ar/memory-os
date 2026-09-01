import { identityKey, type EntityIdentity } from "../domain/dataset.js";

export interface ProbeMetrics {
  readonly recallAt1: number;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly meanReciprocalRank: number;
  readonly ndcgAt10: number;
  readonly leakedForbidden: readonly EntityIdentity[];
}

function uniqueRanked(ranked: readonly EntityIdentity[]): readonly EntityIdentity[] {
  const seen = new Set<string>();
  return ranked.filter((identity) => {
    const key = identityKey(identity);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recallAt(
  ranked: readonly EntityIdentity[],
  relevant: ReadonlySet<string>,
  cutoff: number,
): number {
  if (relevant.size === 0) return 0;
  const found = ranked.slice(0, cutoff).filter((item) => relevant.has(identityKey(item))).length;
  return found / relevant.size;
}

function dcg(gains: readonly number[]): number {
  return gains.reduce((sum, gain, index) => sum + (2 ** gain - 1) / Math.log2(index + 2), 0);
}

export function computeProbeMetrics(
  rankedInput: readonly EntityIdentity[],
  relevantInput: readonly EntityIdentity[],
  forbiddenInput: readonly EntityIdentity[],
): ProbeMetrics {
  const ranked = uniqueRanked(rankedInput);
  const relevant = new Map(relevantInput.map((item) => [identityKey(item), item.relevance ?? 1]));
  const firstRelevantIndex = ranked.findIndex((item) => relevant.has(identityKey(item)));
  const actualGains = ranked.slice(0, 10).map((item) => relevant.get(identityKey(item)) ?? 0);
  const idealGains = [...relevant.values()].sort((left, right) => right - left).slice(0, 10);
  const idealDcg = dcg(idealGains);
  const forbidden = new Set(forbiddenInput.map(identityKey));

  return {
    recallAt1: recallAt(ranked, new Set(relevant.keys()), 1),
    recallAt5: recallAt(ranked, new Set(relevant.keys()), 5),
    recallAt10: recallAt(ranked, new Set(relevant.keys()), 10),
    meanReciprocalRank: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAt10: idealDcg === 0 ? 0 : dcg(actualGains) / idealDcg,
    leakedForbidden: ranked.filter((item) => forbidden.has(identityKey(item))),
  };
}
