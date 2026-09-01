import type { ProjectCatalogStore, ProjectOverview } from "./types.js";

export function createListProjects(
  store: ProjectCatalogStore,
): () => Promise<readonly ProjectOverview[]> {
  return () => store.listProjectOverviews();
}
