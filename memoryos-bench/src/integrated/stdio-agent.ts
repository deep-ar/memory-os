import { spawn } from "node:child_process";
import { z } from "zod";
import type { IntegratedAgent, IntegratedAgentDescriptor, IntegratedAgentRequest, IntegratedInvocationResult } from "./agent.js";

const ProtocolResponseSchema = z.object({ output: z.unknown() }).strict();

export class StdioIntegratedAgent implements IntegratedAgent {
  readonly #descriptor: IntegratedAgentDescriptor;
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
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#descriptor = {
      provider: options.provider,
      model: options.model,
      version: options.version,
      reasoningMode: options.reasoningMode ?? null,
      adapter: "stdio",
      telemetrySource: "agent_adapter_reported",
    };
  }

  describe(): IntegratedAgentDescriptor { return this.#descriptor; }

  async invoke(request: IntegratedAgentRequest): Promise<IntegratedInvocationResult> {
    const started = performance.now();
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Integrated agent timed out after ${this.#timeoutMs} ms.`)));
      }, this.#timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 10_000_000) {
          child.kill();
          finish(() => reject(new Error("Integrated agent stdout exceeded 10 MB.")));
        }
      });
      child.stderr.on("data", (chunk: string) => { errors += chunk; });
      child.stdin.once("error", (error) => finish(() => reject(error)));
      child.once("error", (error) => finish(() => reject(error)));
      child.once("close", (code) => finish(() => code === 0
        ? resolve(output)
        : reject(new Error(`Integrated agent exited with code ${code ?? "unknown"}: ${errors.slice(0, 2_000)}`))));
      child.stdin.end(JSON.stringify(request));
    });
    let response: z.infer<typeof ProtocolResponseSchema>;
    try {
      const parsed: unknown = JSON.parse(stdout);
      response = ProtocolResponseSchema.parse(parsed);
    } catch (error) {
      throw new Error("Integrated stdio adapter received an invalid JSON protocol response.", { cause: error });
    }
    return {
      rawOutput: typeof response.output === "string" ? response.output : JSON.stringify(response.output),
      wallTimeMs: performance.now() - started,
    };
  }

  async close(): Promise<void> {}
}
