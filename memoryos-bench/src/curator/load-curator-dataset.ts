import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatasetDescriptor } from "../domain/run-context.js";
import { parseCuratorDataset, type CuratorDataset } from "./dataset.js";

export interface LoadedCuratorDataset {
  readonly dataset: CuratorDataset;
  readonly descriptor: DatasetDescriptor;
}

export async function loadCuratorDataset(path: string): Promise<LoadedCuratorDataset> {
  const source = resolve(path);
  const content = await readFile(source);
  const parsed: unknown = JSON.parse(content.toString("utf8"));
  return {
    dataset: parseCuratorDataset(parsed),
    descriptor: {
      source,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  };
}
