export class MemoryOsHttpClient {
  readonly #baseUrl: URL;
  readonly #authToken: string | undefined;

  constructor(baseUrl: string, authToken?: string) {
    this.#baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    this.#authToken = authToken;
  }

  async ready(): Promise<unknown> {
    return this.#request("ready");
  }

  async integrity(): Promise<{ readonly status: "healthy" | "degraded" }> {
    return this.#request("api/v1/integrity", undefined, [503]) as Promise<{
      readonly status: "healthy" | "degraded";
    }>;
  }

  async registerProject(input: {
    readonly projectId: string;
    readonly name: string;
    readonly description?: string;
    readonly repositoryUri?: string;
  }): Promise<unknown> {
    return this.#request("api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: input.projectId,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.repositoryUri === undefined ? {} : { repository_uri: input.repositoryUri }),
      }),
    });
  }

  async #request(path: string, init?: RequestInit, acceptedErrorStatuses: readonly number[] = []): Promise<unknown> {
    const headers = new Headers(init?.headers);
    if (this.#authToken !== undefined) headers.set("authorization", `Bearer ${this.#authToken}`);
    const response = await fetch(new URL(path, this.#baseUrl), { ...init, headers });
    const payload = await response.json().catch(() => ({ status: "failed", error: { message: response.statusText } }));
    if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
      throw new Error(`MemoryOS HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }
}
