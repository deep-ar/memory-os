import type { CuratorEpisode, CuratorOutput } from "./dataset.js";

export interface CuratorAgentDescriptor {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly reasoningMode: string | null;
  readonly adapter: "replay" | "stdio" | "fake";
}

export interface AgentCost {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly toolCalls: number | null;
  readonly wallTimeMs: number;
  readonly apiCost: number | null;
}

export interface CuratorAgentRequest {
  readonly requestId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly systemPrompt: string;
  readonly promptVersion: string;
  readonly memorySkillVersion: string;
  readonly episode: Omit<CuratorEpisode, "gold_output" | "evaluation">;
  readonly outputContract: {
    readonly format: "json";
    readonly root: "memory_delta";
    readonly instruction: string;
  };
}

export interface CuratorAgentResult {
  readonly rawOutput: string;
  readonly cost: AgentCost;
}

export interface CuratorAgent {
  describe(): CuratorAgentDescriptor;
  invoke(request: CuratorAgentRequest): Promise<CuratorAgentResult>;
  close(): Promise<void>;
}

export function createCuratorRequest(input: {
  readonly dataset: {
    readonly id: string;
    readonly version: string;
    readonly prompt_version: string;
    readonly memory_skill_version: string;
    readonly system_prompt: string;
  };
  readonly episode: CuratorEpisode;
}): CuratorAgentRequest {
  const { gold_output: _goldOutput, evaluation: _evaluation, ...episode } = input.episode;
  return {
    requestId: `${input.episode.id}:${input.dataset.prompt_version}`,
    datasetId: input.dataset.id,
    datasetVersion: input.dataset.version,
    systemPrompt: input.dataset.system_prompt,
    promptVersion: input.dataset.prompt_version,
    memorySkillVersion: input.dataset.memory_skill_version,
    episode,
    outputContract: {
      format: "json",
      root: "memory_delta",
      instruction: "Return one strict JSON object with a memory_delta property and no Markdown fences.",
    },
  };
}

export function curatorOutputToRaw(output: CuratorOutput): string {
  return JSON.stringify(output);
}
