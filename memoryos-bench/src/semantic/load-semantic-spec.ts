import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSemanticKnowledgeSpec } from "./model.js";

export async function loadSemanticKnowledgeSpec(path: string) {
  const source = resolve(path);
  const raw = await readFile(source, "utf8");
  return parseSemanticKnowledgeSpec(JSON.parse(raw));
}
