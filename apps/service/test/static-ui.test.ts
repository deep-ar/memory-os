import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const current = { provider: "ollama" as const, model: "bge-m3", digest: "digest", dimension: 1024 };

describe("static administration SPA", () => {
  it("serves compiled index and assets without shadowing service routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoryos-static-test-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>MemoryOS Explorer</title>");
    await writeFile(join(root, "assets", "app.js"), "console.log('memoryos')");
    const app = createApp({
      readiness: { storage: "ready", embedding: current, embeddingIndex: { status: "empty" } },
      staticRoot: root,
    });

    const page = await app.inject({ method: "GET", url: "/" });
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    const readiness = await app.inject({ method: "GET", url: "/ready" });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("MemoryOS Explorer");
    expect(asset.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({ status: "ready" });
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
});
