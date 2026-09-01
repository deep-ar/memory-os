import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import type { IntegratedMemoryContext, IntegratedMemoryContextProvider } from "../integrated/agent.js";
import type { ExperimentalMode, IntegratedScenario, MemoryItem } from "../integrated/dataset.js";

const RegistrationSchema = z.object({ status: z.enum(["created", "exists"]) }).passthrough();
const ContextSchema = z.object({
  claims: z.array(z.object({
    id: z.string().min(1),
    statement: z.string().min(1),
    lifecycleStatus: z.string().min(1),
  }).passthrough()),
}).passthrough();

type BackendMode = "oracle_writes" | "full_memory_os";

export class MemoryOsIntegratedContextProvider implements IntegratedMemoryContextProvider {
  readonly #serviceUrl: URL;
  readonly #authToken: string | undefined;
  readonly #client = new Client({ name: "memoryos-bench-integrated", version: "0.1.0" });
  readonly #seeded = new Set<string>();
  readonly #goldByProject = new Map<string, ReadonlyMap<string, MemoryItem>>();
  #connected = false;

  constructor(options: { readonly serviceUrl: string; readonly authToken?: string }) {
    this.#serviceUrl = new URL(options.serviceUrl.endsWith("/") ? options.serviceUrl : `${options.serviceUrl}/`);
    this.#authToken = options.authToken;
  }

  async contextFor(scenario: IntegratedScenario, mode: ExperimentalMode): Promise<IntegratedMemoryContext> {
    if (mode !== "oracle_writes" && mode !== "full_memory_os") {
      throw new Error(`MemoryOS provider cannot serve mode '${mode}'.`);
    }
    const projectId = this.#projectId(scenario, mode);
    const preparationTimeMs = await this.#seed(scenario, mode, projectId);
    const started = performance.now();
    const result = await this.#callTool("memory.get_context", {
      project_id: projectId,
      task_description: scenario.task,
      token_budget: 4_000,
    });
    if (result.isError === true) throw new Error(`MemoryOS get_context failed for '${projectId}'.`);
    const parsed = ContextSchema.parse(result.structuredContent);
    const gold = this.#goldByProject.get(projectId) ?? new Map<string, MemoryItem>();
    const items = parsed.claims.map((claim): MemoryItem => {
      const original = gold.get(claim.id);
      return {
        id: claim.id,
        text: claim.statement,
        source_project_id: original?.source_project_id ?? projectId,
        kind: "claim",
        stale: original?.stale ?? ["superseded", "invalidated", "historical"].includes(claim.lifecycleStatus),
      };
    });
    return {
      items,
      source: mode === "oracle_writes" ? "memoryos_oracle_writes" : "memoryos_fixture_curated",
      retrievalTimeMs: performance.now() - started,
      preparationTimeMs,
    };
  }

  async close(): Promise<void> {
    if (!this.#connected) return;
    await this.#client.close();
    this.#connected = false;
  }

  #projectId(scenario: IntegratedScenario, mode: BackendMode): string {
    return `${scenario.project_id}-${mode === "oracle_writes" ? "oracle" : "full"}-v01`;
  }

  async #seed(scenario: IntegratedScenario, mode: BackendMode, projectId: string): Promise<number> {
    if (this.#seeded.has(projectId)) return 0;
    const response = await fetch(new URL("api/v1/projects", this.#serviceUrl), {
      method: "POST",
      headers: { ...this.#headers(), "content-type": "application/json" },
      body: JSON.stringify({ project_id: projectId, name: `Integrated ${mode} ${scenario.id}` }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`MemoryOS project registration failed with HTTP ${response.status}: ${body.slice(0, 1_000)}`);
    const registration = RegistrationSchema.parse(JSON.parse(body));
    if (registration.status !== "created") throw new Error(`Benchmark project '${projectId}' already exists; refusing contaminated live context run.`);
    const memories = scenario.memory[mode];
    this.#goldByProject.set(projectId, new Map(memories.map((item) => [item.id, item])));
    const writeStarted = performance.now();
    const result = await this.#callTool("memory.apply_delta", {
      project_id: projectId,
      memory_delta: {
        expected_revision: 0,
        reflection: {
          agent_id: "memoryos-bench",
          agent_type: "benchmark",
          session_id: "integrated-controlled-v0.1",
          task_id: `${scenario.id}:${mode}:seed`,
          workspace_id: null,
          worktree_id: null,
          branch: null,
          commit: null,
          trigger: "manual",
        },
        concepts: memories.map((item) => ({
          id: `${item.id}-concept`, project_id: projectId, canonical_name: item.id,
          description: item.text, concept_type: "benchmark_memory", aliases: [],
        })),
        claims: memories.map((item) => ({
          id: item.id,
          project_id: projectId,
          subject_id: `${item.id}-concept`,
          predicate: "RECOMMENDS",
          object_id: null,
          statement: item.text,
          epistemic_basis: "tested",
          confidence_level: "verified",
          lifecycle_status: item.stale ? "historical" : "active",
          valid_from: null,
          valid_to: null,
          last_verified_at: "2026-09-01T00:00:00.000Z",
          context_ids: [], evidence_ids: [], supports: [], contradicts: [], supersedes: [], refines: [], derived_from: [],
        })),
        evidence: [],
        contexts: [],
      },
    });
    const writeTimeMs = performance.now() - writeStarted;
    if (result.isError === true) throw new Error(`MemoryOS rejected integrated seed for '${projectId}'.`);
    this.#seeded.add(projectId);
    return writeTimeMs;
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
