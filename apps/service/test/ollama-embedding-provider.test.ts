import { describe, expect, it, vi } from "vitest";
import { OllamaEmbeddingProvider } from "../src/adapters/embeddings/ollama-embedding-provider.js";
import { EmbeddingFailure, isSameEmbeddingIndex } from "../src/modules/retrieval/index.js";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerWith(vector: number[]) {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        models: [{ name: "bge-m3:latest", model: "bge-m3:latest", digest: "sha256:a" }],
      }),
    )
    .mockResolvedValueOnce(
      response({ model: "bge-m3:latest", embeddings: [vector] }),
    )
    .mockResolvedValueOnce(
      response({
        models: [{ name: "bge-m3:latest", model: "bge-m3:latest", digest: "sha256:a" }],
      }),
    );
  return new OllamaEmbeddingProvider({
    baseUrl: "http://ollama.test",
    model: "bge-m3",
    expectedDimension: 3,
    fetch: fetchMock,
  });
}

describe("OllamaEmbeddingProvider", () => {
  it("returns vectors together with immutable index identity", async () => {
    const batch = await providerWith([0.1, 0.2, 0.3]).embed(["память agent"]);

    expect(batch).toEqual({
      identity: {
        provider: "ollama",
        model: "bge-m3:latest",
        digest: "sha256:a",
        dimension: 3,
      },
      vectors: [[0.1, 0.2, 0.3]],
    });
  });

  it("rejects a vector with the wrong dimension", async () => {
    await expect(providerWith([0.1, 0.2]).embed(["query"])).rejects.toMatchObject({
      code: "EMBEDDING_FAILURE",
      reason: "DIMENSION_MISMATCH",
    } satisfies Partial<EmbeddingFailure>);
  });

  it("rejects non-finite vector values", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          models: [{ name: "bge-m3:latest", model: "bge-m3:latest", digest: "sha256:a" }],
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model: "bge-m3:latest", embeddings: [[0.1, Number.NaN, 0.3]] }),
      } as Response);
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://ollama.test",
      model: "bge-m3",
      expectedDimension: 3,
      fetch: fetchMock,
    });

    await expect(provider.embed(["query"])).rejects.toMatchObject({
      code: "EMBEDDING_FAILURE",
      reason: "NON_FINITE_VECTOR",
    } satisfies Partial<EmbeddingFailure>);
  });

  it("treats model digest and dimension as part of the index identity", () => {
    const base = { provider: "ollama", model: "bge-m3:latest", digest: "a", dimension: 1024 } as const;
    expect(isSameEmbeddingIndex(base, { ...base, digest: "b" })).toBe(false);
    expect(isSameEmbeddingIndex(base, { ...base, dimension: 768 })).toBe(false);
  });

  it("rejects a model alias that changes digest during embedding", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          models: [{ name: "bge-m3:latest", model: "bge-m3:latest", digest: "sha256:a" }],
        }),
      )
      .mockResolvedValueOnce(
        response({ model: "bge-m3:latest", embeddings: [[0.1, 0.2, 0.3]] }),
      )
      .mockResolvedValueOnce(
        response({
          models: [{ name: "bge-m3:latest", model: "bge-m3:latest", digest: "sha256:b" }],
        }),
      );
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://ollama.test",
      model: "bge-m3",
      expectedDimension: 3,
      fetch: fetchMock,
    });

    await expect(provider.embed(["query"])).rejects.toMatchObject({
      code: "EMBEDDING_FAILURE",
      reason: "MODEL_CHANGED",
    } satisfies Partial<EmbeddingFailure>);
  });
});
