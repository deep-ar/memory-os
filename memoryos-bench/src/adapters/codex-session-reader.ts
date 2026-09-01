import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  CodexSessionTranscriptSchema,
  type CodexCompletedTurn,
  type CodexSessionTranscript,
} from "../real-replay/model.js";

interface SessionMetaPayload {
  readonly id?: unknown;
  readonly session_id?: unknown;
  readonly timestamp?: unknown;
  readonly cwd?: unknown;
  readonly source?: unknown;
  readonly git?: { readonly branch?: unknown; readonly commit_hash?: unknown };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsonlFiles(path);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  }));
  return nested.flat();
}

async function firstLine(path: string): Promise<string> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) return line;
  } finally {
    lines.close();
    input.destroy();
  }
  throw new Error(`Codex session '${path}' is empty.`);
}

function metaPayload(line: string, path: string): SessionMetaPayload {
  const parsed = record(JSON.parse(line));
  if (parsed?.type !== "session_meta") throw new Error(`Codex session '${path}' does not start with session_meta.`);
  const payload = record(parsed.payload);
  if (payload === null) throw new Error(`Codex session '${path}' has invalid session_meta payload.`);
  return payload as SessionMetaPayload;
}

function sameWorkspace(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

export async function discoverCodexSessions(options: {
  readonly sessionsRoot: string;
  readonly workspaceCwd: string;
}): Promise<readonly { readonly path: string; readonly meta: SessionMetaPayload }[]> {
  const matches: { path: string; meta: SessionMetaPayload }[] = [];
  for (const path of await jsonlFiles(resolve(options.sessionsRoot))) {
    let meta: SessionMetaPayload;
    try {
      meta = metaPayload(await firstLine(path), path);
    } catch {
      continue;
    }
    if (typeof meta.cwd === "string" && sameWorkspace(meta.cwd, options.workspaceCwd)) matches.push({ path, meta });
  }
  return matches.sort((left, right) => String(left.meta.timestamp).localeCompare(String(right.meta.timestamp)));
}

export async function readCodexSession(path: string): Promise<CodexSessionTranscript> {
  const sourcePath = resolve(path);
  const file = await stat(sourcePath);
  const observedSize = file.size;
  const input = createReadStream(sourcePath, { encoding: "utf8", start: 0, end: Math.max(0, observedSize - 1) });
  const hash = createHash("sha256");
  input.on("data", (chunk: string | Buffer) => hash.update(chunk));
  const lines = createInterface({ input, crlfDelay: Infinity });
  let meta: SessionMetaPayload | null = null;
  let pendingUserMessages: string[] = [];
  const turns: CodexCompletedTurn[] = [];
  let abortedTurns = 0;
  for await (const line of lines) {
    if (meta === null) {
      meta = metaPayload(line, sourcePath);
      continue;
    }
    if (!line.includes('"type":"user_message"') && !line.includes('"type":"task_complete"') && !line.includes('"type":"turn_aborted"')) continue;
    let parsed: Record<string, unknown> | null;
    try {
      parsed = record(JSON.parse(line));
    } catch {
      continue;
    }
    if (parsed?.type !== "event_msg") continue;
    const payload = record(parsed.payload);
    const timestamp = stringOrNull(parsed.timestamp);
    if (payload?.type === "user_message") {
      const message = stringOrNull(payload.message);
      if (message !== null) pendingUserMessages.push(message);
    } else if (payload?.type === "turn_aborted") {
      abortedTurns += 1;
      pendingUserMessages = [];
    } else if (payload?.type === "task_complete" && timestamp !== null) {
      turns.push({
        index: turns.length + 1,
        user_message: pendingUserMessages.join("\n\n"),
        assistant_message: typeof payload.last_agent_message === "string" ? payload.last_agent_message : "",
        completed_at: timestamp,
      });
      pendingUserMessages = [];
    }
  }
  if (meta === null) throw new Error(`Codex session '${sourcePath}' has no metadata.`);
  const sessionId = stringOrNull(meta.id) ?? stringOrNull(meta.session_id);
  const startedAt = stringOrNull(meta.timestamp);
  if (sessionId === null || startedAt === null) throw new Error(`Codex session '${sourcePath}' has incomplete identity metadata.`);
  const git = record(meta.git);
  return CodexSessionTranscriptSchema.parse({
    metadata: {
      session_id: sessionId,
      source_path: sourcePath,
      started_at: startedAt,
      observed_size_bytes: observedSize,
      observed_sha256: hash.digest("hex"),
      branch: stringOrNull(git?.branch),
      commit: stringOrNull(git?.commit_hash),
      completed_turns: turns.length,
      aborted_turns: abortedTurns,
      last_completed_at: turns.at(-1)?.completed_at ?? null,
      source_kind: typeof meta.source === "string" ? "root" : "subagent",
    },
    turns,
  });
}
