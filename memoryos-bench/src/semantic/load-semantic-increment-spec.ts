import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSemanticKnowledgeIncrementSpec } from "./model.js";

export async function loadSemanticKnowledgeIncrementSpec(path: string) {
  const source = resolve(path);
  const raw = await readFile(source, "utf8");
  return parseSemanticKnowledgeIncrementSpec(JSON.parse(raw));
}
