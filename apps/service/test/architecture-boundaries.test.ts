import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return typescriptFiles(path);
      }
      return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("architecture boundaries", () => {
  it("keeps domain/application modules independent of infrastructure", async () => {
    const modulesDirectory = fileURLToPath(new URL("../src/modules", import.meta.url));
    const files = await typescriptFiles(modulesDirectory);
    const forbidden = [
      /from\s+["']fastify["']/u,
      /from\s+["']falkordb["']/u,
      /from\s+["'][^"']*adapters\//u,
      /from\s+["'][^"']*transports\//u,
      /process\.env/u,
    ];

    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${file}: ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the React explorer behind the versioned Admin HTTP boundary", async () => {
    const webDirectory = fileURLToPath(new URL("../../web/src", import.meta.url));
    const files = await typescriptFiles(webDirectory);
    const forbidden = [
      /from\s+["'][^"']*service\/src/u,
      /from\s+["']falkordb["']/u,
      /from\s+["']@modelcontextprotocol\//u,
    ];
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern.source}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
