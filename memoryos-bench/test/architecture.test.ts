import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

describe("benchmark architecture boundary", () => {
  it("does not import MemoryOS internals or FalkorDB", async () => {
    const sourceRoot = resolve("src");
    const violations: string[] = [];
    for (const path of await typescriptFiles(sourceRoot)) {
      const content = await readFile(path, "utf8");
      if (/from\s+["'][^"']*(?:apps\/service|@memoryos\/service|falkordb)/u.test(content)) {
        violations.push(relative(sourceRoot, path));
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps curator policy independent from MCP and the MemoryOS adapter", async () => {
    const curatorRoot = resolve("src/curator");
    const violations: string[] = [];
    for (const path of await typescriptFiles(curatorRoot)) {
      const content = await readFile(path, "utf8");
      if (/@modelcontextprotocol|memoryos-backend|\.\.\/kernel/u.test(content)) {
        violations.push(relative(curatorRoot, path));
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps integrated policy independent from MCP, filesystem and process adapters", async () => {
    const policyFiles = [
      "src/integrated/agent.ts",
      "src/integrated/citation-contract.ts",
      "src/integrated/dataset.ts",
      "src/integrated/metrics.ts",
      "src/integrated/run-integrated-benchmark.ts",
      "src/integrated/workspace.ts",
    ];
    const violations: string[] = [];
    for (const relativePath of policyFiles) {
      const content = await readFile(resolve(relativePath), "utf8");
      if (/@modelcontextprotocol|memoryos-backend|node:fs|node:child_process/u.test(content)) violations.push(relativePath);
    }
    expect(violations).toEqual([]);
  });

  it("keeps real replay policy independent from MCP, filesystem and process adapters", async () => {
    const policyFiles = [
      "src/real-replay/model.ts",
      "src/real-replay/memory-provider.ts",
      "src/real-replay/prepare-real-replay.ts",
      "src/real-replay/run-real-replay.ts",
    ];
    const violations: string[] = [];
    for (const relativePath of policyFiles) {
      const content = await readFile(resolve(relativePath), "utf8");
      if (/@modelcontextprotocol|memoryos-backend|node:fs|node:child_process/u.test(content)) violations.push(relativePath);
    }
    expect(violations).toEqual([]);
  });
});
