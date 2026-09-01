import { createHash } from "node:crypto";
import type { BenchmarkDelta } from "../domain/dataset.js";
import {
  RealReplayBundleSchema,
  type CodexCompletedTurn,
  type CodexSessionTranscript,
  type RealReplayBundle,
  type RealReplayCheckpointSpec,
} from "./model.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function redact(value: string): { readonly text: string; readonly redactions: number } {
  let redactions = 0;
  const replace = (pattern: RegExp, replacement: string) => {
    value = value.replace(pattern, (...args: unknown[]) => {
      redactions += 1;
      const first = args[1];
      return typeof first === "string" ? `${first}[REDACTED]` : replacement;
    });
  };
  replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/giu, "[REDACTED]");
  replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/giu, "[REDACTED]");
  replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu, "[REDACTED PRIVATE KEY]");
  return { text: value, redactions };
}

function clean(value: string, maxLength: number): { readonly text: string; readonly redactions: number } {
  const withoutMemoryFooter = value.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu, "");
  const result = redact(withoutMemoryFooter);
  return { text: truncate(result.text, maxLength), redactions: result.redactions };
}

function sourceId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9]/gu, "").slice(-12).toLowerCase();
}

function projectSession(options: {
  readonly transcript: CodexSessionTranscript;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly cutoffAt: string;
}): { readonly delta: BenchmarkDelta | null; readonly cards: number; readonly redactions: number; readonly excludedAtCutoff: number } {
  const eligible = options.transcript.turns.filter((turn) => Date.parse(turn.completed_at) < Date.parse(options.cutoffAt));
  const excludedAtCutoff = options.transcript.turns.length - eligible.length;
  const sessionKey = sourceId(options.transcript.metadata.session_id);
  const cards: {
    readonly turn: CodexCompletedTurn;
    readonly task: string;
    readonly conclusion: string;
    readonly redactions: number;
  }[] = [];
  for (const turn of eligible) {
    const task = clean(turn.user_message, 1_200);
    const conclusion = clean(turn.assistant_message, 4_000);
    if (task.text.length < 10 || conclusion.text.length < 80) continue;
    cards.push({ turn, task: task.text, conclusion: conclusion.text, redactions: task.redactions + conclusion.redactions });
  }
  if (cards.length === 0) return { delta: null, cards: 0, redactions: 0, excludedAtCutoff };
  const conceptId = `session-${sessionKey}`;
  const claims = cards.map(({ turn, task, conclusion }) => {
    const base = `s${sessionKey}-t${String(turn.index).padStart(4, "0")}`;
    return {
      id: `claim-${base}`,
      project_id: options.projectId,
      subject_id: conceptId,
      predicate: "RECORDED_CONCLUSION",
      object_id: null,
      statement: `Task: ${task}\nSession conclusion: ${conclusion}`,
      epistemic_basis: "observed" as const,
      confidence_level: "supported" as const,
      lifecycle_status: "active" as const,
      valid_from: turn.completed_at,
      valid_to: null,
      last_verified_at: turn.completed_at,
      context_ids: [],
      evidence_ids: [`evidence-${base}`],
      supports: [], contradicts: [], supersedes: [], refines: [], derived_from: [],
    };
  });
  const evidence = cards.map(({ turn, task, conclusion }) => {
    const base = `s${sessionKey}-t${String(turn.index).padStart(4, "0")}`;
    return {
      id: `evidence-${base}`,
      project_id: options.projectId,
      type: "agent_observation" as const,
      summary: `Completed Codex turn: ${truncate(task, 500)}`,
      content: null,
      source_uri: `codex-session://${options.transcript.metadata.session_id}#turn-${turn.index}`,
      repo: "D:/Projects/LucyCocos",
      commit: options.transcript.metadata.commit,
      branch: options.transcript.metadata.branch,
      file: null, symbol: null, line_start: null, line_end: null, command: null,
      result: truncate(conclusion, 1_000), quote: null,
      observed_at: turn.completed_at,
      retrieved_at: null,
      content_hash: sha256(`${turn.user_message}\n${turn.assistant_message}`),
    };
  });
  return {
    delta: {
      id: `session-${sessionKey}-projection`,
      project_id: options.projectId,
      memory_delta: {
        expected_revision: options.expectedRevision,
        reflection: {
          agent_id: "memoryos-bench",
          agent_type: "codex-session-projector",
          session_id: options.transcript.metadata.session_id,
          task_id: "completed-turn-projection-v0.1",
          workspace_id: "D:/Projects/LucyCocos",
          worktree_id: null,
          branch: options.transcript.metadata.branch,
          commit: options.transcript.metadata.commit,
          trigger: "manual",
        },
        concepts: [{
          id: conceptId,
          project_id: options.projectId,
          canonical_name: `Codex session ${options.transcript.metadata.session_id}`,
          description: "Conclusions recorded in one completed LucyCocos root session.",
          concept_type: "codex_session",
          aliases: [options.transcript.metadata.session_id],
        }],
        claims,
        evidence,
        contexts: [],
      },
    },
    cards: cards.length,
    redactions: cards.reduce((sum, card) => sum + card.redactions, 0),
    excludedAtCutoff,
  };
}

export function prepareRealReplayBundle(options: {
  readonly sessions: readonly CodexSessionTranscript[];
  readonly checkpointSpec: RealReplayCheckpointSpec;
  readonly excludedSubagentSessions?: number;
}): RealReplayBundle {
  const roots = options.sessions.filter((session) => session.metadata.source_kind === "root")
    .sort((left, right) => left.metadata.started_at.localeCompare(right.metadata.started_at));
  const holdout = roots.find((session) => session.metadata.session_id === options.checkpointSpec.holdout_session_id);
  if (holdout === undefined) throw new Error(`Holdout root session '${options.checkpointSpec.holdout_session_id}' was not found.`);
  const cutoffAt = holdout.metadata.started_at;
  const train = roots.filter((session) => Date.parse(session.metadata.started_at) < Date.parse(cutoffAt));
  const deltas: BenchmarkDelta[] = [];
  let cards = 0;
  let redactions = 0;
  let excludedAtCutoff = 0;
  for (const transcript of train) {
    const projection = projectSession({ transcript, projectId: options.checkpointSpec.project_id, expectedRevision: deltas.length, cutoffAt });
    if (projection.delta !== null) deltas.push(projection.delta);
    cards += projection.cards;
    redactions += projection.redactions;
    excludedAtCutoff += projection.excludedAtCutoff;
  }
  const byTurn = new Map(holdout.turns.map((turn) => [turn.index, turn]));
  const checkpoints = options.checkpointSpec.checkpoints.map((checkpoint) => {
    const turn = byTurn.get(checkpoint.source_turn_index);
    if (turn === undefined || turn.assistant_message.trim().length === 0) {
      throw new Error(`Holdout checkpoint '${checkpoint.id}' refers to missing or incomplete turn ${checkpoint.source_turn_index}.`);
    }
    const task = clean(turn.user_message, 4_000);
    if (task.text.length === 0) throw new Error(`Holdout checkpoint '${checkpoint.id}' has an empty task after redaction.`);
    redactions += task.redactions;
    return {
      id: checkpoint.id,
      source_turn_index: checkpoint.source_turn_index,
      source_completed_at: turn.completed_at,
      task: task.text,
      decision_options: checkpoint.decision_options,
      expected_decision: checkpoint.expected_decision,
      gold_basis: checkpoint.gold_basis,
    };
  });
  const completedPrefix = holdout.turns.filter((turn) => turn.assistant_message.trim().length > 0);
  return RealReplayBundleSchema.parse({
    schema_version: 1,
    id: options.checkpointSpec.id,
    version: options.checkpointSpec.version,
    title: options.checkpointSpec.title,
    profile: "real-session-replay-v0.1",
    project: {
      id: options.checkpointSpec.project_id,
      name: "LucyCocos chronological replay memory",
      description: "Isolated MemoryOS benchmark project built from pre-holdout root Codex sessions.",
      repository_uri: "git@github.com:WoodenRocket/LucyCocos.git",
    },
    split: {
      rule: "root_sessions_before_holdout_start",
      cutoff_at: cutoffAt,
      train_sessions: train.map((session) => session.metadata),
      holdout_session: holdout.metadata,
      excluded_subagent_sessions: options.excludedSubagentSessions
        ?? options.sessions.filter((session) => session.metadata.source_kind === "subagent").length,
      excluded_train_turns_at_or_after_cutoff: excludedAtCutoff,
      holdout_completed_prefix_sha256: sha256(JSON.stringify(completedPrefix)),
    },
    memory: {
      projection_version: "completed-turn-leading-conclusion-v0.1",
      redactions,
      cards,
      deltas,
    },
    evaluation: {
      gold_status: options.checkpointSpec.gold_status,
      repetitions: options.checkpointSpec.repetitions,
      checkpoints,
    },
  });
}
