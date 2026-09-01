import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCuratorRequest } from "../src/curator/agent.js";
import { loadCuratorDataset } from "../src/curator/load-curator-dataset.js";
import { StdioCuratorAgent } from "../src/curator/stdio-agent.js";

describe("StdioCuratorAgent", () => {
  it("uses the provider-neutral stdin/stdout JSON protocol without a shell", async () => {
    const { dataset } = await loadCuratorDataset(resolve("datasets/curator-controlled-v0.1.json"));
    const agent = new StdioCuratorAgent({
      executable: process.execPath,
      args: [resolve("test/fixtures/stdio-curator-agent.mjs")],
      provider: "test-provider",
      model: "echo-curator",
      version: "1",
      timeoutMs: 5_000,
    });
    const result = await agent.invoke(createCuratorRequest({ dataset, episode: dataset.episodes[0]! }));

    expect(JSON.parse(result.rawOutput)).toMatchObject({ memory_delta: { expected_revision: 0 } });
    expect(result.cost.inputTokens).toBe(12);
    expect(result.cost.outputTokens).toBe(7);
    expect(result.cost.wallTimeMs).toBeGreaterThan(0);
    expect(agent.describe().adapter).toBe("stdio");
  });
});
