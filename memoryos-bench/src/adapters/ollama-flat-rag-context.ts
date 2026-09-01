import { z } from "zod";
import type { IntegratedMemoryContext, IntegratedMemoryContextProvider } from "../integrated/agent.js";
import type { ExperimentalMode, IntegratedDataset, IntegratedScenario, MemoryItem } from "../integrated/dataset.js";

const EmbedResponseSchema = z.object({ embeddings: z.array(z.array(z.number())) }).passthrough();

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm === 0 || rightNorm === 0 ? Number.NEGATIVE_INFINITY : dot / Math.sqrt(leftNorm * rightNorm);
}

export class OllamaFlatRagContextProvider implements IntegratedMemoryContextProvider {
  readonly #endpoint: URL;
  readonly #model: string;
  readonly #limit: number;
  readonly #items: readonly MemoryItem[];
  #corpusEmbeddings: Promise<readonly (readonly number[])[]> | null = null;

  constructor(options: {
    readonly dataset: IntegratedDataset;
    readonly ollamaUrl: string;
    readonly model: string;
    readonly limit?: number;
  }) {
    this.#endpoint = new URL("api/embed", options.ollamaUrl.endsWith("/") ? options.ollamaUrl : `${options.ollamaUrl}/`);
    this.#model = options.model;
    this.#limit = options.limit ?? 3;
    if (!Number.isInteger(this.#limit) || this.#limit < 1) throw new Error("Flat RAG limit must be a positive integer.");
    const byId = new Map<string, MemoryItem>();
    for (const item of options.dataset.scenarios.flatMap((scenario) => scenario.memory.flat_rag)) byId.set(item.id, item);
    this.#items = [...byId.values()];
  }

  async contextFor(scenario: IntegratedScenario, mode: ExperimentalMode): Promise<IntegratedMemoryContext> {
    if (mode !== "flat_rag") throw new Error(`Flat RAG provider cannot serve mode '${mode}'.`);
    const started = performance.now();
    const [corpus, query] = await Promise.all([this.#embeddings(), this.#embed([scenario.task])]);
    const queryVector = query[0];
    if (queryVector === undefined) throw new Error("Ollama returned no query embedding.");
    const items = this.#items.map((item, index) => ({ item, score: cosine(corpus[index] ?? [], queryVector) }))
      .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
      .slice(0, this.#limit)
      .map(({ item }) => item);
    return { items, source: "flat_rag", retrievalTimeMs: performance.now() - started, preparationTimeMs: 0 };
  }

  async close(): Promise<void> {}

  #embeddings(): Promise<readonly (readonly number[])[]> {
    this.#corpusEmbeddings ??= this.#embed(this.#items.map((item) => item.text));
    return this.#corpusEmbeddings;
  }

  async #embed(input: readonly string[]): Promise<readonly (readonly number[])[]> {
    const response = await fetch(this.#endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.#model, input }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Ollama embedding failed with HTTP ${response.status}: ${body.slice(0, 1_000)}`);
    return EmbedResponseSchema.parse(JSON.parse(body)).embeddings;
  }
}
