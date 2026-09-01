import { spawn } from "node:child_process";
import { z } from "zod";
import type {
  AgentCost,
  CuratorAgent,
  CuratorAgentDescriptor,
  CuratorAgentRequest,
  CuratorAgentResult,
} from "./agent.js";

const StdioResultSchema = z.object({
  output: z.unknown(),
  cost: z.object({
    input_tokens: z.number().nonnegative().nullable().optional(),
    output_tokens: z.number().nonnegative().nullable().optional(),
    cached_tokens: z.number().nonnegative().nullable().optional(),
    tool_calls: z.number().nonnegative().nullable().optional(),
    api_cost: z.number().nonnegative().nullable().optional(),
  }).strict().optional(),
}).strict();

export class StdioCuratorAgent implements CuratorAgent {
  readonly #descriptor: CuratorAgentDescriptor;
  readonly #executable: string;
  readonly #args: readonly string[];
  readonly #timeoutMs: number;

  constructor(options: {
    readonly executable: string;
    readonly args?: readonly string[];
    readonly provider: string;
    readonly model: string;
    readonly version: string;
    readonly reasoningMode?: string | null;
    readonly timeoutMs?: number;
  }) {
    this.#executable = options.executable;
    this.#args = options.args ?? [];
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#descriptor = {
      provider: options.provider,
      model: options.model,
      version: options.version,
      reasoningMode: options.reasoningMode ?? null,
      adapter: "stdio",
    };
  }

  describe(): CuratorAgentDescriptor {
    return this.#descriptor;
  }

  async invoke(request: CuratorAgentRequest): Promise<CuratorAgentResult> {
    const started = performance.now();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#args], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Curator agent timed out after ${this.#timeoutMs} ms.`)));
      }, this.#timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 5_000_000) {
          child.kill();
          finish(() => reject(new Error("Curator agent stdout exceeded 5 MB.")));
        }
      });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", (error) => finish(() => reject(error)));
      child.once("close", (code) => finish(() => {
        if (code !== 0) {
          reject(new Error(`Curator agent exited with code ${code ?? "unknown"}: ${stderr.slice(0, 2_000)}`));
        } else {
          resolve(stdout);
        }
      }));
      child.stdin.end(JSON.stringify(request));
    });

    let parsed: z.infer<typeof StdioResultSchema>;
    try {
      const json: unknown = JSON.parse(output);
      parsed = StdioResultSchema.parse(json);
    } catch (error) {
      throw new Error("Curator stdio adapter received an invalid JSON protocol response.", { cause: error });
    }
    const cost: AgentCost = {
      inputTokens: parsed.cost?.input_tokens ?? null,
      outputTokens: parsed.cost?.output_tokens ?? null,
      cachedTokens: parsed.cost?.cached_tokens ?? null,
      toolCalls: parsed.cost?.tool_calls ?? null,
      wallTimeMs: performance.now() - started,
      apiCost: parsed.cost?.api_cost ?? null,
    };
    return {
      rawOutput: typeof parsed.output === "string" ? parsed.output : JSON.stringify(parsed.output),
      cost,
    };
  }

  async close(): Promise<void> {}
}
