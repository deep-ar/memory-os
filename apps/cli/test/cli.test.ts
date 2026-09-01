import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliDependencies } from "../src/cli.js";
import { runCli } from "../src/cli.js";

function dependencies(): CliDependencies {
  return {
    runner: { run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) },
    compose: {
      up: vi.fn(async () => undefined),
      backup: vi.fn(async (snapshot: string) => ({
        format: "memoryos-falkordb-rdb-v1",
        createdAt: "2026-08-30T00:00:00.000Z",
        sha256: "abc",
        bytes: 10,
        snapshot,
      })),
      restore: vi.fn(async (restored: string) => ({
        restored,
        safetyBackup: {
          format: "memoryos-falkordb-rdb-v1",
          createdAt: "2026-08-30T00:00:00.000Z",
          sha256: "def",
          bytes: 20,
          snapshot: "safety.rdb",
        },
      })),
    },
    stdout: vi.fn(),
    environment: { LOCALAPPDATA: join(tmpdir(), "memoryos-cli-missing-config") },
  };
}

describe("MemoryOS CLI", () => {
  it("requires explicit global-data replacement confirmation", async () => {
    const deps = dependencies();
    await expect(runCli(["restore", "--input", "backup.rdb"], deps))
      .rejects.toThrow("--confirm-replace-all-data");
    expect(deps.compose.restore).not.toHaveBeenCalled();
  });

  it("delegates confirmed restore to the Compose operations adapter", async () => {
    const deps = dependencies();
    await expect(runCli([
      "restore", "--input", "backup.rdb", "--confirm-replace-all-data",
    ], deps)).resolves.toBe(0);
    expect(deps.compose.restore).toHaveBeenCalledWith("backup.rdb");
  });

  it("requires project identity instead of deriving it from the working directory", async () => {
    const deps = dependencies();
    await expect(runCli(["project", "init"], deps)).rejects.toThrow("--project-id");
  });
});
