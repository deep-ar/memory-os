import { z } from "zod";
import {
  EmbeddingFailure,
  isSameEmbeddingIndex,
  type EmbeddingBatch,
  type EmbeddingModelIdentity,
  type EmbeddingProvider,
} from "../../modules/retrieval/index.js";

const tagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      model: z.string(),
      digest: z.string().min(1),
    }),
  ),
});

const embedResponseSchema = z.object({
  model: z.string(),
  embeddings: z.array(z.array(z.unknown())),
});

export interface OllamaEmbeddingProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly expectedDimension: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

function normalizedModelName(model: string): string {
  return model.endsWith(":latest") ? model.slice(0, -":latest".length) : model;
}

function matchesModel(candidate: string, requested: string): boolean {
  return normalizedModelName(candidate) === normalizedModelName(requested);
}

function containsOnlyNumbers(values: readonly unknown[]): values is number[] {
  return values.every((value) => typeof value === "number");
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #expectedDimension: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: OllamaEmbeddingProviderOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#model = options.model;
    this.#expectedDimension = options.expectedDimension;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async describeModel(): Promise<EmbeddingModelIdentity> {
    const payload = await this.#requestJson("/api/tags", { method: "GET" });
    const parsed = tagsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new EmbeddingFailure(
        "INVALID_RESPONSE",
        "Ollama /api/tags returned an invalid response.",
        { cause: parsed.error },
      );
    }

    const model = parsed.data.models.find(
      (candidate) =>
        matchesModel(candidate.name, this.#model) ||
        matchesModel(candidate.model, this.#model),
    );
    if (model === undefined) {
      throw new EmbeddingFailure(
        "MODEL_NOT_FOUND",
        `Ollama model '${this.#model}' is not installed.`,
      );
    }

    return {
      provider: "ollama",
      model: model.model,
      digest: model.digest,
      dimension: this.#expectedDimension,
    };
  }

  async embed(texts: readonly string[]): Promise<EmbeddingBatch> {
    const identity = await this.describeModel();
    if (texts.length === 0) {
      return { identity, vectors: [] };
    }

    const payload = await this.#requestJson("/api/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.#model, input: texts }),
    });
    const parsed = embedResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.embeddings.length !== texts.length) {
      throw new EmbeddingFailure(
        "INVALID_RESPONSE",
        "Ollama /api/embed returned an invalid embedding batch.",
        parsed.success ? undefined : { cause: parsed.error },
      );
    }
    if (!matchesModel(parsed.data.model, identity.model)) {
      throw new EmbeddingFailure(
        "INVALID_RESPONSE",
        `Ollama embedded with '${parsed.data.model}', expected '${identity.model}'.`,
      );
    }

    const vectors: number[][] = [];
    for (const vector of parsed.data.embeddings) {
      if (!containsOnlyNumbers(vector)) {
        throw new EmbeddingFailure(
          "INVALID_RESPONSE",
          "Ollama returned an embedding containing a non-number value.",
        );
      }
      if (vector.length !== this.#expectedDimension) {
        throw new EmbeddingFailure(
          "DIMENSION_MISMATCH",
          `Embedding dimension ${vector.length} does not match ${this.#expectedDimension}.`,
        );
      }
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new EmbeddingFailure(
          "NON_FINITE_VECTOR",
          "Ollama returned an embedding containing a non-finite value.",
        );
      }
      vectors.push(vector);
    }

    const identityAfterEmbedding = await this.describeModel();
    if (!isSameEmbeddingIndex(identity, identityAfterEmbedding)) {
      throw new EmbeddingFailure(
        "MODEL_CHANGED",
        "The Ollama model identity changed while the embedding batch was generated.",
      );
    }

    return { identity: identityAfterEmbedding, vectors };
  }

  async #requestJson(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof EmbeddingFailure) {
        throw error;
      }
      throw new EmbeddingFailure(
        "REQUEST_FAILED",
        `Ollama request to ${path} failed.`,
        { cause: error },
      );
    }
  }
}
