export type RetrievalChannelName = "semantic" | "full_text" | "graph";

export interface RankedReference {
  readonly entityId: string;
  readonly entityType: "concept" | "claim" | "evidence";
}

export interface ChannelRanking {
  readonly channel: RetrievalChannelName;
  readonly results: readonly RankedReference[];
}

export interface FusedReference extends RankedReference {
  readonly score: number;
  readonly channelRanks: Readonly<Partial<Record<RetrievalChannelName, number>>>;
}

function referenceKey(reference: RankedReference): string {
  return `${reference.entityType}:${reference.entityId}`;
}

export function reciprocalRankFusion(
  rankings: readonly ChannelRanking[],
  options: { readonly k?: number; readonly maxResults?: number } = {},
): readonly FusedReference[] {
  const k = options.k ?? 60;
  const maxResults = options.maxResults ?? 20;
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError("RRF k must be a positive integer.");
  }
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new RangeError("RRF maxResults must be a positive integer.");
  }

  const fused = new Map<
    string,
    {
      reference: RankedReference;
      score: number;
      channelRanks: Partial<Record<RetrievalChannelName, number>>;
    }
  >();

  for (const ranking of rankings) {
    const seenInChannel = new Set<string>();
    ranking.results.forEach((reference, index) => {
      const key = referenceKey(reference);
      if (seenInChannel.has(key)) {
        return;
      }
      seenInChannel.add(key);

      const rank = index + 1;
      const current = fused.get(key) ?? {
        reference,
        score: 0,
        channelRanks: {},
      };
      current.score += 1 / (k + rank);
      current.channelRanks[ranking.channel] = rank;
      fused.set(key, current);
    });
  }

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        referenceKey(left.reference).localeCompare(referenceKey(right.reference)),
    )
    .slice(0, maxResults)
    .map(({ reference, score, channelRanks }) => ({
      ...reference,
      score,
      channelRanks,
    }));
}

