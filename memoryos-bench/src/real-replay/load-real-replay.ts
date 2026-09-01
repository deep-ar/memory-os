import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatasetDescriptor } from "../domain/run-context.js";
import { parseRealReplayBundle, parseRealReplayCheckpointSpec } from "./model.js";

export async function loadRealReplayCheckpointSpec(path: string) {
  const source = resolve(path);
  const raw = await readFile(source, "utf8");
  return parseRealReplayCheckpointSpec(JSON.parse(raw));
}

export async function loadRealReplayBundle(path: string): Promise<{
  readonly bundle: ReturnType<typeof parseRealReplayBundle>;
  readonly descriptor: DatasetDescriptor;
}> {
  const source = resolve(path);
  const raw = await readFile(source, "utf8");
  return {
    bundle: parseRealReplayBundle(JSON.parse(raw)),
    descriptor: { source, sha256: createHash("sha256").update(raw).digest("hex") },
  };
}
