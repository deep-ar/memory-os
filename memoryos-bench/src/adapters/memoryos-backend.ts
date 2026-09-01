import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  MemoryBackendError,
  type MemoryBackend,
  type ProjectRegistration,
  type SearchObservation,
} from "../domain/backend.js";
import type { BenchmarkDelta, BenchmarkProject, SearchProbe } from "../domain/dataset.js";
import type { JsonValue } from "../domain/json.js";

const ProjectRegistrationResponseSchema = z.object({
  status: z.enum(["created", "exists"]),
}).passthrough();

const ProjectListResponseSchema = z.object({
  projects: z.array(z.object({
    project: z.object({ id: z.string().min(1) }).passthrough(),
  }).passthrough()),
}).passthrough();

const SearchResponseSchema = z.object({
  entryPoints: z.array(z.object({
    entityId: z.string().min(1),
    entityType: z.enum(["concept", "claim", "evidence"]),
  }).passthrough()),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    type: z.string().min(1),
  }).passthrough()).default([]),
}).passthrough();

function jsonRecord(input: unknown): Readonly<Record<string, JsonValue>> {
  const normalized: unknown = JSON.parse(JSON.stringify(input));
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    return { value: normalized as JsonValue };
  }
  return normalized as Readonly<Record<string, JsonValue>>;
}

function responseError(status: number, body: string): string {
  return body.length === 0 ? `HTTP ${status}` : `HTTP ${status}: ${body}`;
}

export class MemoryOsPublicBackend implements MemoryBackend {
  readonly #serviceUrl: URL;
  readonly #authToken: string | undefined;
  readonly #client = new Client({ name: "memoryos-bench", version: "0.1.0" });
  #connected = false;

  constructor(options: { readonly serviceUrl: string; readonly authToken?: string }) {
    this.#serviceUrl = new URL(options.serviceUrl.endsWith("/") ? options.serviceUrl : `${options.serviceUrl}/`);
    this.#authToken = options.authToken;
  }

  async describe(): Promise<Readonly<Record<string, JsonValue>>> {
    const endpoint = new URL("ready", this.#serviceUrl);
    const response = await fetch(endpoint, { headers: this.#headers() });
    const body = await response.text();
    if (!response.ok) {
      throw new MemoryBackendError(responseError(response.status, body), "describe");
    }
    let readiness: unknown;
    try {
      readiness = JSON.parse(body);
    } catch (error) {
      throw new MemoryBackendError("MemoryOS readiness response is not JSON.", "describe", error);
    }
    return {
      adapter: "memoryos-public-mcp-http",
      serviceUrl: this.#serviceUrl.toString(),
      readiness: jsonRecord(readiness),
    };
  }

  async registerProject(project: BenchmarkProject): Promise<ProjectRegistration> {
    const response = await fetch(new URL("api/v1/projects", this.#serviceUrl), {
      method: "POST",
      headers: { ...this.#headers(), "content-type": "application/json" },
      body: JSON.stringify({
        project_id: project.id,
        name: project.name,
        ...(project.description === undefined ? {} : { description: project.description }),
        ...(project.repository_uri === undefined ? {} : { repository_uri: project.repository_uri }),
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new MemoryBackendError(responseError(response.status, body), "register_project");
    }
    let parsed: z.infer<typeof ProjectRegistrationResponseSchema>;
    try {
      parsed = ProjectRegistrationResponseSchema.parse(JSON.parse(body));
    } catch (error) {
      throw new MemoryBackendError("Invalid project registration response from MemoryOS.", "register_project", error);
    }
    return { created: parsed.status === "created" };
  }

  async findExistingProjects(projectIds: readonly string[]): Promise<readonly string[]> {
    const response = await fetch(new URL("api/v1/projects", this.#serviceUrl), { headers: this.#headers() });
    const body = await response.text();
    if (!response.ok) {
      throw new MemoryBackendError(responseError(response.status, body), "register_project");
    }
    let parsed: z.infer<typeof ProjectListResponseSchema>;
    try {
      parsed = ProjectListResponseSchema.parse(JSON.parse(body));
    } catch (error) {
      throw new MemoryBackendError("Invalid project list response from MemoryOS.", "register_project", error);
    }
    const requested = new Set(projectIds);
    return parsed.projects.map((overview) => overview.project.id).filter((id) => requested.has(id));
  }

  async applyDelta(delta: BenchmarkDelta): Promise<void> {
    const result = await this.#callTool("memory.apply_delta", {
      project_id: delta.project_id,
      memory_delta: delta.memory_delta,
    }, "apply_delta");
    if (result.isError === true) {
      throw new MemoryBackendError("MemoryOS rejected benchmark MemoryDelta.", "apply_delta", result.structuredContent);
    }
  }

  async search(probe: SearchProbe): Promise<SearchObservation> {
    const result = await this.#callTool("memory.search", {
      project_id: probe.project_id,
      query: probe.query.text,
      ...(probe.query.context === undefined ? {} : { context: probe.query.context }),
      ...(probe.query.include === undefined ? {} : { include: probe.query.include }),
      ...(probe.query.time === undefined ? {} : { time: probe.query.time }),
      max_results: probe.query.max_results,
      graph_depth: probe.query.graph_depth,
    }, "search");
    if (result.isError === true) {
      throw new MemoryBackendError("MemoryOS search failed.", "search", result.structuredContent);
    }
    let parsed: z.infer<typeof SearchResponseSchema>;
    try {
      parsed = SearchResponseSchema.parse(result.structuredContent);
    } catch (error) {
      throw new MemoryBackendError("Invalid memory.search response from MemoryOS.", "search", error);
    }
    return {
      ranked: parsed.entryPoints.map((entry) => ({
        entity_type: entry.entityType,
        entity_id: entry.entityId,
      })),
      edges: parsed.edges,
    };
  }

  async close(): Promise<void> {
    if (!this.#connected) return;
    await this.#client.close();
    this.#connected = false;
  }

  async #callTool(
    name: string,
    args: Record<string, unknown>,
    operation: "apply_delta" | "search",
  ) {
    await this.#connect(operation);
    try {
      return await this.#client.callTool({ name, arguments: args });
    } catch (error) {
      throw new MemoryBackendError(`MCP tool '${name}' failed.`, operation, error);
    }
  }

  async #connect(operation: "apply_delta" | "search"): Promise<void> {
    if (this.#connected) return;
    try {
      await this.#client.connect(new StreamableHTTPClientTransport(new URL("mcp", this.#serviceUrl), {
        requestInit: { headers: this.#headers() },
      }));
      this.#connected = true;
    } catch (error) {
      throw new MemoryBackendError("Cannot connect to the public MemoryOS MCP endpoint.", operation, error);
    }
  }

  #headers(): Record<string, string> {
    return this.#authToken === undefined ? {} : { authorization: `Bearer ${this.#authToken}` };
  }
}
