import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  AgentCost,
  CuratorAgent,
  CuratorAgentDescriptor,
  CuratorAgentRequest,
  CuratorAgentResult,
} from "./agent.js";

const NullableCountSchema = z.number().nonnegative().nullable().default(null);

const ReplayFileSchema = z.object({
  schema_version: z.literal(1),
  dataset_id: z.string().min(1),
  dataset_version: z.string().min(1),
  prompt_version: z.string().min(1),
  memory_skill_version: z.string().min(1),
  agent: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    version: z.string().min(1),
    reasoning_mode: z.string().min(1).nullable().default(null),
  }).strict(),
  responses: z.record(z.string(), z.object({
    output: z.unknown(),
    cost: z.object({
      input_tokens: NullableCountSchema,
      output_tokens: NullableCountSchema,
      cached_tokens: NullableCountSchema,
      tool_calls: NullableCountSchema,
      wall_time_ms: z.number().nonnegative(),
      api_cost: NullableCountSchema,
    }).strict(),
  }).strict()),
}).strict();

type ReplayFile = z.infer<typeof ReplayFileSchema>;

function mapCost(cost: ReplayFile["responses"][string]["cost"]): AgentCost {
  return {
    inputTokens: cost.input_tokens,
    outputTokens: cost.output_tokens,
    cachedTokens: cost.cached_tokens,
    toolCalls: cost.tool_calls,
    wallTimeMs: cost.wall_time_ms,
    apiCost: cost.api_cost,
  };
}

export class ReplayCuratorAgent implements CuratorAgent {
  readonly #replay: ReplayFile;

  private constructor(replay: ReplayFile) {
    this.#replay = replay;
  }

  static async load(path: string): Promise<ReplayCuratorAgent> {
    const content = await readFile(resolve(path), "utf8");
    const parsed: unknown = JSON.parse(content);
    return new ReplayCuratorAgent(ReplayFileSchema.parse(parsed));
  }

  describe(): CuratorAgentDescriptor {
    return {
      provider: this.#replay.agent.provider,
      model: this.#replay.agent.model,
      version: this.#replay.agent.version,
      reasoningMode: this.#replay.agent.reasoning_mode,
      adapter: "replay",
    };
  }

  async invoke(request: CuratorAgentRequest): Promise<CuratorAgentResult> {
    const incompatibilities = [
      ["dataset id", request.datasetId, this.#replay.dataset_id],
      ["dataset version", request.datasetVersion, this.#replay.dataset_version],
      ["prompt version", request.promptVersion, this.#replay.prompt_version],
      ["memory skill version", request.memorySkillVersion, this.#replay.memory_skill_version],
    ].filter(([, actual, expected]) => actual !== expected);
    if (incompatibilities.length > 0) {
      throw new Error(`Replay is incompatible: ${incompatibilities.map(([name, actual, expected]) => `${name} '${actual}' != '${expected}'`).join(", ")}.`);
    }
    const replay = this.#replay.responses[request.episode.id];
    if (replay === undefined) throw new Error(`Replay response is missing for episode '${request.episode.id}'.`);
    return {
      rawOutput: typeof replay.output === "string" ? replay.output : JSON.stringify(replay.output),
      cost: mapCost(replay.cost),
    };
  }

  async close(): Promise<void> {}
}
