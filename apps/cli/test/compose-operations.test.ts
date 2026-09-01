import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createComposeOperations } from "../src/compose-operations.js";
import type { ProcessRunner } from "../src/process-runner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Compose backup and restore", () => {
  it("creates an integrity manifest and validates it before orchestrating restore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memoryos-cli-test-"));
    temporaryDirectories.push(directory);
    const calls: string[][] = [];
    const runner: ProcessRunner = {
      async run(_command, args) {
        calls.push([...args]);
        if (args.includes("cp") && String(args.at(-2)).startsWith("falkordb:")) {
          await writeFile(String(args.at(-1)), Buffer.from("REDIS0011memoryos-test"));
        }
        if (args.includes("PING")) return { code: 0, stdout: "PONG\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const operations = createComposeOperations({
      composeFile: "C:/memoryos/compose.yaml",
      runner,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
      wait: async () => undefined,
    });
    const snapshot = join(directory, "snapshot.rdb");

    const manifest = await operations.backup(snapshot);
    expect(manifest.bytes).toBeGreaterThan(5);
    expect(JSON.parse(await readFile(`${snapshot}.manifest.json`, "utf8"))).toMatchObject({
      format: "memoryos-falkordb-rdb-v1",
      sha256: manifest.sha256,
    });

    await expect(operations.restore(snapshot)).resolves.toMatchObject({ restored: snapshot });
    expect(calls.some((args) => args.includes("stop"))).toBe(true);
    expect(calls.some((args) => args.includes("--force-recreate"))).toBe(true);
    expect(calls.some((args) => args.includes("PING"))).toBe(true);
  });

  it("rejects a modified snapshot before stopping services", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memoryos-cli-test-"));
    temporaryDirectories.push(directory);
    const calls: string[][] = [];
    const runner: ProcessRunner = {
      async run(_command, args) {
        calls.push([...args]);
        if (args.includes("cp")) await writeFile(String(args.at(-1)), Buffer.from("REDIS0011original"));
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const operations = createComposeOperations({ composeFile: "compose.yaml", runner });
    const snapshot = join(directory, "snapshot.rdb");
    await operations.backup(snapshot);
    await writeFile(snapshot, Buffer.from("REDIS0011tampered"));
    calls.length = 0;

    await expect(operations.restore(snapshot)).rejects.toThrow("integrity validation");
    expect(calls).toEqual([]);
  });
});
