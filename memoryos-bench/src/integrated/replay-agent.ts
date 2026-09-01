import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { IntegratedAgent, IntegratedAgentDescriptor, IntegratedAgentRequest, IntegratedInvocationResult } from "./agent.js";

const ReplaySchema = z.object({
  schema_version: z.literal(1),
  dataset_id: z.string().min(1),
  dataset_version: z.string().min(1),
  prompt_version: z.string().min(1),
  toolset_version: z.string().min(1),
  response_contract_version: z.string().min(1),
  agent: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    version: z.string().min(1),
    reasoning_mode: z.string().min(1).nullable(),
  }).strict(),
  responses: z.record(z.string(), z.object({ output: z.unknown(), wall_time_ms: z.number().nonnegative() }).strict()),
}).strict();

type Replay = z.infer<typeof ReplaySchema>;

export class ReplayIntegratedAgent implements IntegratedAgent {
  readonly #replay: Replay;

  private constructor(replay: Replay) { this.#replay = replay; }

  static async load(path: string): Promise<ReplayIntegratedAgent> {
    const content = await readFile(resolve(path), "utf8");
    const parsed: unknown = JSON.parse(content);
    return new ReplayIntegratedAgent(ReplaySchema.parse(parsed));
  }

  describe(): IntegratedAgentDescriptor {
    return {
      provider: this.#replay.agent.provider,
      model: this.#replay.agent.model,
      version: this.#replay.agent.version,
      reasoningMode: this.#replay.agent.reasoning_mode,
      adapter: "replay",
      telemetrySource: "calibration_fixture",
    };
  }

  async invoke(request: IntegratedAgentRequest): Promise<IntegratedInvocationResult> {
    const mismatches = [
      ["dataset id", request.datasetId, this.#replay.dataset_id],
      ["dataset version", request.datasetVersion, this.#replay.dataset_version],
      ["prompt version", request.promptVersion, this.#replay.prompt_version],
      ["toolset version", request.toolsetVersion, this.#replay.toolset_version],
      ["response contract version", request.responseContractVersion, this.#replay.response_contract_version],
    ].filter(([, actual, expected]) => actual !== expected);
    if (mismatches.length > 0) {
      throw new Error(`Integrated replay is incompatible: ${mismatches.map(([name, actual, expected]) => `${name} '${actual}' != '${expected}'`).join(", ")}.`);
    }
    const response = this.#replay.responses[`${request.scenario.id}:${request.mode}`];
    if (response === undefined) throw new Error(`Replay response is missing for '${request.scenario.id}:${request.mode}'.`);
    return {
      rawOutput: typeof response.output === "string" ? response.output : JSON.stringify(response.output),
      wallTimeMs: response.wall_time_ms,
    };
  }

  async close(): Promise<void> {}
}
