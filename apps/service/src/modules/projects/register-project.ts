import type {
  ProjectRegistrationResult,
  ProjectRegistrationStore,
  RegisterProjectCommand,
} from "./types.js";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

export function createRegisterProject(store: ProjectRegistrationStore) {
  return async function registerProject(
    command: RegisterProjectCommand,
  ): Promise<ProjectRegistrationResult> {
    const id = command.id.trim();
    const name = command.name.trim();
    if (!PROJECT_ID.test(id) || id.length > 128) {
      throw new RangeError("Project id must be 1-128 safe identity characters.");
    }
    if (name.length === 0 || name.length > 200) {
      throw new RangeError("Project name must be between 1 and 200 characters.");
    }
    const requested = {
      id,
      name,
      description: command.description?.trim() || null,
      repositoryUri: command.repositoryUri?.trim() || null,
      revision: 0,
      schemaVersion: 1 as const,
    };
    const result = await store.registerProject(requested);
    const sameIdentity = result.project.name === requested.name
      && result.project.description === requested.description
      && result.project.repositoryUri === requested.repositoryUri;
    if (!result.created && !sameIdentity) {
      return {
        ok: false,
        error: {
          code: "PROJECT_ID_CONFLICT",
          message: `Project id '${id}' already has different registration metadata.`,
          existing: result.project,
        },
      };
    }
    return { ok: true, created: result.created, project: result.project };
  };
}
