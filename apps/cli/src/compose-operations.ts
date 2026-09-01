import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ProcessRunner } from "./process-runner.js";
import { requireSuccess } from "./process-runner.js";

const RDB_PATH = "/var/lib/falkordb/data/dump.rdb";

export interface BackupManifest {
  readonly format: "memoryos-falkordb-rdb-v1";
  readonly createdAt: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly snapshot: string;
}

export interface ComposeOperations {
  up(): Promise<void>;
  backup(output: string): Promise<BackupManifest>;
  restore(input: string): Promise<{ readonly restored: string; readonly safetyBackup: BackupManifest }>;
}

function manifestPath(snapshotPath: string): string {
  return `${snapshotPath}.manifest.json`;
}

async function snapshotIdentity(snapshotPath: string): Promise<{ sha256: string; bytes: number }> {
  const content = await readFile(snapshotPath);
  if (content.length < 9 || content.subarray(0, 5).toString("ascii") !== "REDIS") {
    throw new Error(`Backup '${snapshotPath}' is not a valid Redis RDB file.`);
  }
  return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length };
}

async function verifySnapshot(snapshotPath: string): Promise<void> {
  const identity = await snapshotIdentity(snapshotPath);
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath(snapshotPath), "utf8")) as BackupManifest;
  } catch {
    throw new Error(`Backup manifest '${manifestPath(snapshotPath)}' is missing or invalid.`);
  }
  if (manifest.format !== "memoryos-falkordb-rdb-v1"
    || manifest.sha256 !== identity.sha256
    || manifest.bytes !== identity.bytes) {
    throw new Error(`Backup '${snapshotPath}' failed SHA-256 integrity validation.`);
  }
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function createComposeOperations(options: {
  readonly composeFile: string;
  readonly runner: ProcessRunner;
  readonly now?: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): ComposeOperations {
  const compose = (...args: readonly string[]) => ["compose", "-f", options.composeFile, ...args];
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)));

  async function backup(output: string): Promise<BackupManifest> {
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await requireSuccess(options.runner, "docker", compose("exec", "-T", "falkordb", "redis-cli", "SAVE"));
    await requireSuccess(options.runner, "docker", compose("cp", `falkordb:${RDB_PATH}`, outputPath));
    const identity = await snapshotIdentity(outputPath);
    const manifest: BackupManifest = {
      format: "memoryos-falkordb-rdb-v1",
      createdAt: now().toISOString(),
      sha256: identity.sha256,
      bytes: identity.bytes,
      snapshot: outputPath,
    };
    await writeFile(manifestPath(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  return {
    async up() {
      await requireSuccess(options.runner, "docker", compose("up", "--build", "-d"));
    },
    backup,
    async restore(input) {
      const inputPath = resolve(input);
      const inputInfo = await stat(inputPath).catch(() => null);
      if (inputInfo === null || !inputInfo.isFile()) throw new Error(`Backup '${inputPath}' does not exist.`);
      await verifySnapshot(inputPath);

      const safetyPath = resolve(dirname(inputPath), `pre-restore-${timestampForFilename(now())}.rdb`);
      const safetyBackup = await backup(safetyPath);
      await requireSuccess(options.runner, "docker", compose("stop", "memoryos", "falkordb"));
      await requireSuccess(options.runner, "docker", compose("create", "--force-recreate", "falkordb"));
      await requireSuccess(options.runner, "docker", compose("cp", inputPath, `falkordb:${RDB_PATH}`));
      await requireSuccess(options.runner, "docker", compose("start", "falkordb"));

      let healthy = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const ping = await options.runner.run(
          "docker",
          compose("exec", "-T", "falkordb", "redis-cli", "PING"),
          { quiet: true },
        );
        if (ping.code === 0 && ping.stdout.trim() === "PONG") {
          healthy = true;
          break;
        }
        await wait(2_000);
      }
      if (!healthy) {
        throw new Error(`Restored FalkorDB did not become healthy. Safety backup: ${safetyBackup.snapshot}`);
      }
      await requireSuccess(options.runner, "docker", compose("up", "-d", "memoryos"));
      return { restored: inputPath, safetyBackup };
    },
  };
}
