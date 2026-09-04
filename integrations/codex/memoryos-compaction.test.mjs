import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./memoryos-compaction.mjs", import.meta.url));

const runHook = (event, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], {
    cwd: options.cwd,
    env: { ...process.env, MEMORYOS_PROJECT_ID: options.projectId ?? "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  child.stdin.end(JSON.stringify(event));
});

const compactEvent = (cwd) => ({
  session_id: "session-123",
  turn_id: "turn-456",
  transcript_path: join(cwd, "rollout.jsonl"),
  cwd,
  hook_event_name: "SessionStart",
  source: "compact",
});

test("is silent outside a compact SessionStart event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  try {
    const result = await runHook({ ...compactEvent(directory), source: "resume" }, { cwd: directory });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("is silent when the project has no explicit MemoryOS mapping", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  try {
    const result = await runHook(compactEvent(directory), { cwd: directory });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finds a parent manifest and emits a bounded reflection instruction", async () => {
  const root = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  const nested = join(root, "packages", "feature");
  try {
    await mkdir(join(root, ".memoryos"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, ".memoryos", "project.json"), JSON.stringify({ schema_version: 1, project_id: "sample-project" }));

    const result = await runHook(compactEvent(nested), { cwd: nested });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(context, /project_id `sample-project`/u);
    assert.match(context, /Reflection assessment is mandatory; a MemoryOS write is optional/u);
    assert.match(context, /compaction-checkpoint classification and Evidence rules/u);
    assert.match(context, /Do not store the transcript or a session summary/u);
    assert.ok(context.length < 4000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("environment project id is an explicit override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  try {
    const result = await runHook(compactEvent(directory), { cwd: directory, projectId: "from-environment" });
    assert.equal(result.code, 0);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /project_id `from-environment`/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid manifest warns without blocking compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  try {
    const manifest = join(root, ".memoryos", "project.json");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, JSON.stringify({ schema_version: 1, project_id: "not valid!" }));

    const result = await runHook(compactEvent(root), { cwd: root });
    const output = JSON.parse(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(output.continue, true);
    assert.match(output.systemMessage, /invalid project_id/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported manifest schema warns without blocking compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "memoryos-hook-"));
  try {
    const manifest = join(root, ".memoryos", "project.json");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, JSON.stringify({ schema_version: 2, project_id: "sample-project" }));

    const result = await runHook(compactEvent(root), { cwd: root });
    const output = JSON.parse(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(output.continue, true);
    assert.match(output.systemMessage, /unsupported manifest schema/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
