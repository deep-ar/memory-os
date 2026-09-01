import type { EmbeddingModelIdentity } from "./ports.js";

export function embeddingIndexKey(identity: EmbeddingModelIdentity): string {
  return [
    identity.provider,
    identity.model,
    identity.digest,
    identity.dimension,
  ].join(":");
}

export function isSameEmbeddingIndex(
  left: EmbeddingModelIdentity,
  right: EmbeddingModelIdentity,
): boolean {
  return embeddingIndexKey(left) === embeddingIndexKey(right);
}

