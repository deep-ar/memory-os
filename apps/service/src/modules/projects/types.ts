import type { Project } from "../knowledge/index.js";

export interface RegisterProjectCommand {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly repositoryUri?: string | null;
}

export type ProjectRegistrationResult =
  | { readonly ok: true; readonly created: boolean; readonly project: Project }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "PROJECT_ID_CONFLICT";
        readonly message: string;
        readonly existing: Project;
      };
    };

export interface ProjectRegistrationStore {
  registerProject(project: Project): Promise<{
    readonly created: boolean;
    readonly project: Project;
  }>;
}

export interface ProjectMemoryCounts {
  readonly concepts: number;
  readonly claims: number;
  readonly evidence: number;
  readonly contexts: number;
  readonly reflectionEvents: number;
}

export interface ProjectOverview {
  readonly project: Project;
  readonly counts: ProjectMemoryCounts;
}

export interface ProjectCatalogStore {
  listProjectOverviews(): Promise<readonly ProjectOverview[]>;
}
