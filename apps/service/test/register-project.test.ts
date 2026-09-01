import { describe, expect, it } from "vitest";
import type { Project } from "../src/modules/knowledge/index.js";
import { createRegisterProject, type ProjectRegistrationStore } from "../src/modules/projects/index.js";

class ProjectStore implements ProjectRegistrationStore {
  project: Project | null = null;

  async registerProject(project: Project) {
    if (this.project === null) {
      this.project = project;
      return { created: true, project };
    }
    return { created: false, project: this.project };
  }
}

describe("register project", () => {
  it("is idempotent for identical logical metadata", async () => {
    const store = new ProjectStore();
    const register = createRegisterProject(store);
    const command = {
      id: "logical-project", name: "Logical project",
      description: "Shared across worktrees", repositoryUri: "https://example.test/repo.git",
    };

    expect(await register(command)).toMatchObject({ ok: true, created: true });
    expect(await register(command)).toMatchObject({ ok: true, created: false });
  });

  it("rejects reusing an id for different project metadata", async () => {
    const store = new ProjectStore();
    const register = createRegisterProject(store);
    await register({ id: "logical-project", name: "First" });

    const result = await register({ id: "logical-project", name: "Different" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ID_CONFLICT", existing: { name: "First" } },
    });
  });
});
