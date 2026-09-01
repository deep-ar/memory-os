import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatasetDescriptor } from "../domain/run-context.js";

export async function loadJsonReport<T>(path: string, parse: (input: unknown) => T): Promise<{
  readonly report: T;
  readonly descriptor: DatasetDescriptor;
}> {
  const source = resolve(path);
  const content = await readFile(source);
  const parsed: unknown = JSON.parse(content.toString("utf8"));
  return {
    report: parse(parsed),
    descriptor: {
      source,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  };
}
