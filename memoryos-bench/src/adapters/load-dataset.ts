import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDataset, type BenchmarkDataset } from "../domain/dataset.js";
import type { DatasetDescriptor } from "../domain/run-context.js";

export interface LoadedDataset {
  readonly dataset: BenchmarkDataset;
  readonly descriptor: DatasetDescriptor;
}

export async function loadDataset(path: string): Promise<LoadedDataset> {
  const source = resolve(path);
  const content = await readFile(source);
  const parsed: unknown = JSON.parse(content.toString("utf8"));
  return {
    dataset: parseDataset(parsed),
    descriptor: {
      source,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  };
}
