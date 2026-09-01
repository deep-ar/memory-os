import { describe, expect, it } from "vitest";
import { OllamaEmbeddingProvider } from "../src/adapters/embeddings/ollama-embedding-provider.js";

const baseUrl = process.env.OLLAMA_INTEGRATION_URL;
const integration = baseUrl === undefined ? describe.skip : describe;

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

integration("Ollama BGE-M3 integration", () => {
  it("produces finite 1024-dimensional multilingual embeddings", async () => {
    const provider = new OllamaEmbeddingProvider({
      baseUrl: baseUrl!,
      model: "bge-m3",
      expectedDimension: 1024,
      timeoutMs: 120_000,
    });

    const batch = await provider.embed([
      "Как обеспечить атомарную запись в базу данных?",
      "Use one database transaction so the entire write commits or rolls back.",
      "CSS grid controls the visual layout of a web page.",
    ]);

    expect(batch.identity.dimension).toBe(1024);
    expect(batch.identity.digest).not.toHaveLength(0);
    expect(batch.vectors).toHaveLength(3);
    expect(batch.vectors.every((vector) => vector.every(Number.isFinite))).toBe(true);
    expect(cosine(batch.vectors[0]!, batch.vectors[1]!)).toBeGreaterThan(
      cosine(batch.vectors[0]!, batch.vectors[2]!),
    );
  }, 120_000);
});

