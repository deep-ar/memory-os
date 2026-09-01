import type { BenchmarkDelta, BenchmarkProject, EntityIdentity, SearchProbe } from "./dataset.js";
import type { JsonValue } from "./json.js";

export interface ProjectRegistration {
  readonly created: boolean;
}

export interface SearchObservation {
  readonly ranked: readonly EntityIdentity[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly type: string;
  }[];
}

export interface MemoryBackend {
  describe(): Promise<Readonly<Record<string, JsonValue>>>;
  findExistingProjects(projectIds: readonly string[]): Promise<readonly string[]>;
  registerProject(project: BenchmarkProject): Promise<ProjectRegistration>;
  applyDelta(delta: BenchmarkDelta): Promise<void>;
  search(probe: SearchProbe): Promise<SearchObservation>;
  close(): Promise<void>;
}

export class MemoryBackendError extends Error {
  constructor(
    message: string,
    readonly operation: "describe" | "register_project" | "apply_delta" | "search",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MemoryBackendError";
  }
}
