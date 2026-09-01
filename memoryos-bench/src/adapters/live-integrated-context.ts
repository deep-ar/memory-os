import type { IntegratedMemoryContext, IntegratedMemoryContextProvider } from "../integrated/agent.js";
import type { ExperimentalMode, IntegratedDataset, IntegratedScenario } from "../integrated/dataset.js";
import { MemoryOsIntegratedContextProvider } from "./memoryos-integrated-context.js";
import { OllamaFlatRagContextProvider } from "./ollama-flat-rag-context.js";

export class LiveIntegratedMemoryContextProvider implements IntegratedMemoryContextProvider {
  readonly #memoryos: MemoryOsIntegratedContextProvider;
  readonly #flatRag: OllamaFlatRagContextProvider;

  constructor(options: {
    readonly dataset: IntegratedDataset;
    readonly memoryosUrl: string;
    readonly authToken?: string;
    readonly ollamaUrl: string;
    readonly ollamaModel: string;
    readonly flatRagLimit?: number;
  }) {
    this.#memoryos = new MemoryOsIntegratedContextProvider({
      serviceUrl: options.memoryosUrl,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    });
    this.#flatRag = new OllamaFlatRagContextProvider({
      dataset: options.dataset,
      ollamaUrl: options.ollamaUrl,
      model: options.ollamaModel,
      ...(options.flatRagLimit === undefined ? {} : { limit: options.flatRagLimit }),
    });
  }

  async contextFor(scenario: IntegratedScenario, mode: ExperimentalMode): Promise<IntegratedMemoryContext> {
    if (mode === "no_memory") return { items: [], source: "none", retrievalTimeMs: 0, preparationTimeMs: 0 };
    if (mode === "oracle_memory") {
      const started = performance.now();
      return { items: scenario.memory.oracle_memory, source: "fixture_oracle", retrievalTimeMs: performance.now() - started, preparationTimeMs: 0 };
    }
    if (mode === "flat_rag") return this.#flatRag.contextFor(scenario, mode);
    return this.#memoryos.contextFor(scenario, mode);
  }

  async close(): Promise<void> {
    await Promise.all([this.#memoryos.close(), this.#flatRag.close()]);
  }
}
