import type { IntegratedAgentOutput, IntegratedMemoryContext } from "./agent.js";
import type { ExperimentalMode } from "./dataset.js";

export function validateMemoryCitations(input: {
  readonly mode: ExperimentalMode;
  readonly output: IntegratedAgentOutput;
  readonly memory: IntegratedMemoryContext;
}): void {
  if (input.mode === "no_memory" && input.output.memory_citations.length > 0) {
    throw new Error("No-memory run returned memory citations.");
  }
  const knownMemory = new Set(input.memory.items.map((item) => item.id));
  for (const citation of input.output.memory_citations) {
    if (!knownMemory.has(citation.memory_id)) throw new Error(`Agent cited unknown memory '${citation.memory_id}'.`);
  }
}
