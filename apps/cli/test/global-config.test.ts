import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globalConfigPath, readGlobalConfig, writeGlobalConfig } from "../src/global-config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("global MemoryOS configuration", () => {
  it("stores connection settings outside a project directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoryos-config-test-"));
    temporaryDirectories.push(root);
    const environment = { LOCALAPPDATA: root };
    const path = await writeGlobalConfig({
      serviceUrl: "http://127.0.0.1:7310",
      ollamaUrl: "http://127.0.0.1:11434",
      authToken: "memoryos-test-token-at-least-32-characters",
    }, environment);

    expect(path).toBe(globalConfigPath(environment));
    await expect(readGlobalConfig(environment)).resolves.toEqual({
      serviceUrl: "http://127.0.0.1:7310/",
      ollamaUrl: "http://127.0.0.1:11434/",
      authToken: "memoryos-test-token-at-least-32-characters",
    });
  });

  it("rejects weak tokens before persisting them", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoryos-config-test-"));
    temporaryDirectories.push(root);
    await expect(writeGlobalConfig({ authToken: "short" }, { LOCALAPPDATA: root }))
      .rejects.toThrow("at least 32");
  });
});
