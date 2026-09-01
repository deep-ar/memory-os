import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import type { IntegratedMemoryContext } from "../integrated/agent.js";
import type { RealReplayBundle, RealReplayCheckpoint } from "../real-replay/model.js";
import type { RealReplayMemoryPreparation, RealReplayMemoryProvider } from "../real-replay/memory-provider.js";
import { MemoryOsPublicBackend } from "./memoryos-backend.js";

const ContextSchema = z.object({
  claims: z.array(z.object({
    id: z.string().min(1),
    statement: z.string().min(1),
    lifecycleStatus: z.string().min(1),
  }).passthrough()),
}).passthrough();

export class MemoryOsRealReplayContextProvider implements RealReplayMemoryProvider {
  readonly #bundle: RealReplayBundle;
  readonly #serviceUrl: URL;
  readonly #authToken: string | undefined;
  readonly #tokenBudget: number;
  readonly #backend: MemoryOsPublicBackend;
  readonly #client = new Client({ name: "memoryos-bench-real-replay", version: "0.1.0" });
  #connected = false;
  #prepared = false;

  constructor(options: {
    readonly bundle: RealReplayBundle;
    readonly serviceUrl: string;
    readonly authToken?: string;
    readonly tokenBudget?: number;
  }) {
    this.#bundle = options.bundle;
    this.#serviceUrl = new URL(options.serviceUrl.endsWith("/") ? options.serviceUrl : `${options.serviceUrl}/`);
    this.#authToken = options.authToken;
    this.#tokenBudget = options.tokenBudget ?? 4_000;
    this.#backend = new MemoryOsPublicBackend({
      serviceUrl: options.serviceUrl,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    });
  }

  async prepare(): Promise<RealReplayMemoryPreparation> {
    if (this.#prepared) throw new Error("Real replay MemoryOS project was already prepared by this provider.");
    const started = performance.now();
    const projectId = this.#bundle.project.id;
    const existing = await this.#backend.findExistingProjects([projectId]);
    if (existing.length > 0) throw new Error(`Real replay project '${projectId}' already exists; refusing a contaminated run.`);
    const registration = await this.#backend.registerProject(this.#bundle.project);
    if (!registration.created) throw new Error(`Real replay project '${projectId}' was registered concurrently; refusing a contaminated run.`);
    for (const delta of this.#bundle.memory.deltas) await this.#backend.applyDelta(delta);
    this.#prepared = true;
    return {
      projectId,
      durationMs: performance.now() - started,
      deltas: this.#bundle.memory.deltas.length,
      claims: this.#bundle.memory.deltas.reduce((sum, delta) => sum + delta.memory_delta.claims.length, 0),
      evidence: this.#bundle.memory.deltas.reduce((sum, delta) => sum + delta.memory_delta.evidence.length, 0),
    };
  }

  async contextFor(checkpoint: RealReplayCheckpoint): Promise<IntegratedMemoryContext> {
    if (!this.#prepared) throw new Error("Real replay MemoryOS provider must be prepared before retrieval.");
    const started = performance.now();
    const result = await this.#callTool("memory.get_context", {
      project_id: this.#bundle.project.id,
      task_description: checkpoint.task,
      token_budget: this.#tokenBudget,
    });
    if (result.isError === true) {
      throw new Error(`MemoryOS get_context failed for checkpoint '${checkpoint.id}': ${JSON.stringify(result.structuredContent).slice(0, 2_000)}`);
    }
    const parsed = ContextSchema.parse(result.structuredContent);
    return {
      items: parsed.claims.map((claim) => ({
        id: claim.id,
        text: claim.statement,
        source_project_id: this.#bundle.project.id,
        kind: "claim" as const,
        stale: ["superseded", "invalidated", "historical"].includes(claim.lifecycleStatus),
      })),
      source: "memoryos_real_session_projection",
      retrievalTimeMs: performance.now() - started,
      preparationTimeMs: 0,
    };
  }

  async close(): Promise<void> {
    await this.#backend.close();
    if (this.#connected) await this.#client.close();
    this.#connected = false;
  }

  async #callTool(name: string, args: Record<string, unknown>) {
    if (!this.#connected) {
      await this.#client.connect(new StreamableHTTPClientTransport(new URL("mcp", this.#serviceUrl), {
        requestInit: { headers: this.#headers() },
      }));
      this.#connected = true;
    }
    return this.#client.callTool({ name, arguments: args });
  }

  #headers(): Record<string, string> {
    return this.#authToken === undefined ? {} : { authorization: `Bearer ${this.#authToken}` };
  }
}
