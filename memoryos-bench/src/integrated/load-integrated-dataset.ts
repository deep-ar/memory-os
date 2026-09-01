import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatasetDescriptor } from "../domain/run-context.js";
import { parseIntegratedDataset, type IntegratedDataset } from "./dataset.js";

export async function loadIntegratedDataset(path: string): Promise<{
  readonly dataset: IntegratedDataset;
  readonly descriptor: DatasetDescriptor;
}> {
  const source = resolve(path);
  const content = await readFile(source);
  const parsed: unknown = JSON.parse(content.toString("utf8"));
  return {
    dataset: parseIntegratedDataset(parsed),
    descriptor: { source, sha256: createHash("sha256").update(content).digest("hex") },
  };
}
