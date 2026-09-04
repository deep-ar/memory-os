#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const MANIFEST_PARTS = [".memoryos", "project.json"];

const readStdin = async () => {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const warning = (message) => ({
  continue: true,
  systemMessage: `MemoryOS compaction checkpoint skipped: ${message}`,
});

const readManifest = async (startDirectory) => {
  let current = resolve(startDirectory);
  const root = parse(current).root;

  while (true) {
    const path = join(current, ...MANIFEST_PARTS);
    try {
      return { path, value: JSON.parse(await readFile(path, "utf8")) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`cannot read ${path}: ${error.message}`);
    }

    if (current === root) return null;
    current = dirname(current);
  }
};

const resolveProject = async (cwd) => {
  const environmentProjectId = process.env.MEMORYOS_PROJECT_ID?.trim();
  if (environmentProjectId) return { projectId: environmentProjectId, source: "MEMORYOS_PROJECT_ID" };

  const manifest = await readManifest(cwd);
  if (!manifest) return null;

  if (manifest.value?.schema_version !== 1) {
    throw new Error(`unsupported manifest schema in ${manifest.path}`);
  }

  return {
    projectId: typeof manifest.value?.project_id === "string" ? manifest.value.project_id.trim() : "",
    source: manifest.path,
  };
};

const reflectionInstruction = ({ projectId, event, source }) => `MemoryOS reflection checkpoint after context compaction.

Use the memory-reflection skill now for the explicit project_id \`${projectId}\`. Reflection assessment is mandatory; a MemoryOS write is optional. Assess only durable knowledge produced since the latest successful reflection in this session, then resume the interrupted task.

Checkpoint provenance:
- session_id: \`${event.session_id}\`
- turn_id: \`${event.turn_id ?? "unknown"}\`
- project mapping: \`${source}\`
- transcript_path: \`${event.transcript_path ?? "unavailable"}\`

Apply the skill's compaction-checkpoint classification and Evidence rules. Use the compacted context first and inspect the transcript only when exact Evidence or a user decision must be recovered. Do not store the transcript or a session summary. Reconcile with existing Claims before one coherent apply_delta. If nothing passes the admission gate, do not write. If MemoryOS is unavailable, continue safely and disclose that the checkpoint could not be persisted.`;

const main = async () => {
  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch (error) {
    emit(warning(`invalid hook input (${error.message})`));
    return;
  }

  if (event?.hook_event_name !== "SessionStart" || event?.source !== "compact") return;
  if (typeof event.cwd !== "string" || event.cwd.trim() === "") {
    emit(warning("event has no working directory"));
    return;
  }

  let project;
  try {
    project = await resolveProject(event.cwd);
  } catch (error) {
    emit(warning(error.message));
    return;
  }

  // Absence is an intentional opt-out for repositories that do not use MemoryOS.
  if (!project) return;
  if (!PROJECT_ID.test(project.projectId)) {
    emit(warning(`invalid project_id in ${project.source}`));
    return;
  }

  emit({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: reflectionInstruction({ projectId: project.projectId, event, source: project.source }),
    },
  });
};

await main();
