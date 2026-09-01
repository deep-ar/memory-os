import { z } from "zod";
import { WireMemoryDeltaSchema } from "../domain/dataset.js";

const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const InstantSchema = z.string().datetime({ offset: true });

export const CodexSessionMetadataSchema = z.object({
  session_id: IdSchema,
  source_path: z.string().min(1),
  started_at: InstantSchema,
  observed_size_bytes: z.number().int().nonnegative(),
  observed_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  branch: z.string().min(1).nullable(),
  commit: z.string().min(1).nullable(),
  completed_turns: z.number().int().nonnegative(),
  aborted_turns: z.number().int().nonnegative(),
  last_completed_at: InstantSchema.nullable(),
  source_kind: z.enum(["root", "subagent"]),
}).strict();

export const CodexCompletedTurnSchema = z.object({
  index: z.number().int().positive(),
  user_message: z.string(),
  assistant_message: z.string(),
  completed_at: InstantSchema,
}).strict();

export const CodexSessionTranscriptSchema = z.object({
  metadata: CodexSessionMetadataSchema,
  turns: z.array(CodexCompletedTurnSchema),
}).strict();

export const RealReplayCheckpointSpecSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  project_id: IdSchema,
  holdout_session_id: IdSchema,
  gold_status: z.enum(["draft_agent_derived", "human_approved"]),
  repetitions: z.number().int().min(1).default(1),
  checkpoints: z.array(z.object({
    id: IdSchema,
    source_turn_index: z.number().int().positive(),
    decision_options: z.array(IdSchema).min(2),
    expected_decision: IdSchema,
    gold_basis: z.string().min(1),
  }).strict()).min(1),
}).strict().superRefine((spec, context) => {
  const ids = new Set<string>();
  const turns = new Set<number>();
  for (const [index, checkpoint] of spec.checkpoints.entries()) {
    if (ids.has(checkpoint.id)) context.addIssue({ code: "custom", path: ["checkpoints", index, "id"], message: "Duplicate checkpoint id." });
    if (turns.has(checkpoint.source_turn_index)) context.addIssue({ code: "custom", path: ["checkpoints", index, "source_turn_index"], message: "Duplicate source turn." });
    if (!checkpoint.decision_options.includes(checkpoint.expected_decision)) {
      context.addIssue({ code: "custom", path: ["checkpoints", index, "expected_decision"], message: "Expected decision must be one of decision_options." });
    }
    ids.add(checkpoint.id);
    turns.add(checkpoint.source_turn_index);
  }
});

const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1).nullable(),
  repository_uri: z.string().min(1).nullable(),
}).strict();

const DeltaSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  memory_delta: WireMemoryDeltaSchema,
}).strict();

const PreparedCheckpointSchema = z.object({
  id: IdSchema,
  source_turn_index: z.number().int().positive(),
  source_completed_at: InstantSchema,
  task: z.string().min(1),
  decision_options: z.array(IdSchema).min(2),
  expected_decision: IdSchema,
  gold_basis: z.string().min(1),
}).strict();

export const RealReplayBundleSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  profile: z.literal("real-session-replay-v0.1"),
  project: ProjectSchema,
  split: z.object({
    rule: z.literal("root_sessions_before_holdout_start"),
    cutoff_at: InstantSchema,
    train_sessions: z.array(CodexSessionMetadataSchema),
    holdout_session: CodexSessionMetadataSchema,
    excluded_subagent_sessions: z.number().int().nonnegative(),
    excluded_train_turns_at_or_after_cutoff: z.number().int().nonnegative(),
    holdout_completed_prefix_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  memory: z.object({
    projection_version: z.literal("completed-turn-leading-conclusion-v0.1"),
    redactions: z.number().int().nonnegative(),
    cards: z.number().int().nonnegative(),
    deltas: z.array(DeltaSchema),
  }).strict(),
  evaluation: z.object({
    gold_status: z.enum(["draft_agent_derived", "human_approved"]),
    repetitions: z.number().int().min(1),
    checkpoints: z.array(PreparedCheckpointSchema).min(1),
  }).strict(),
}).strict().superRefine((bundle, context) => {
  if (bundle.split.holdout_session.session_id === bundle.project.id) {
    context.addIssue({ code: "custom", path: ["project", "id"], message: "Benchmark project id must not equal a source session id." });
  }
  for (const [index, session] of bundle.split.train_sessions.entries()) {
    if (session.session_id === bundle.split.holdout_session.session_id) {
      context.addIssue({ code: "custom", path: ["split", "train_sessions", index], message: "Holdout session leaked into train sessions." });
    }
    if (Date.parse(session.started_at) >= Date.parse(bundle.split.cutoff_at)) {
      context.addIssue({ code: "custom", path: ["split", "train_sessions", index, "started_at"], message: "Train session must start before the holdout cutoff." });
    }
  }
  const trainSessionIds = new Set(bundle.split.train_sessions.map((session) => session.session_id));
  const deltaIds = new Set<string>();
  let claimCount = 0;
  for (const [index, delta] of bundle.memory.deltas.entries()) {
    if (delta.project_id !== bundle.project.id) {
      context.addIssue({ code: "custom", path: ["memory", "deltas", index, "project_id"], message: "Memory delta belongs to another project." });
    }
    if (deltaIds.has(delta.id)) context.addIssue({ code: "custom", path: ["memory", "deltas", index, "id"], message: "Duplicate memory delta id." });
    deltaIds.add(delta.id);
    if (delta.memory_delta.expected_revision !== index) {
      context.addIssue({ code: "custom", path: ["memory", "deltas", index, "memory_delta", "expected_revision"], message: "Memory delta revisions must be contiguous from zero." });
    }
    const sourceSessionId = delta.memory_delta.reflection.session_id;
    if (sourceSessionId === null || !trainSessionIds.has(sourceSessionId)) {
      context.addIssue({ code: "custom", path: ["memory", "deltas", index, "memory_delta", "reflection", "session_id"], message: "Memory delta must originate from a declared train session." });
    }
    claimCount += delta.memory_delta.claims.length;
    for (const [claimIndex, claim] of delta.memory_delta.claims.entries()) {
      for (const [field, timestamp] of [["valid_from", claim.valid_from], ["last_verified_at", claim.last_verified_at]] as const) {
        if (timestamp !== null && Date.parse(timestamp) >= Date.parse(bundle.split.cutoff_at)) {
          context.addIssue({ code: "custom", path: ["memory", "deltas", index, "memory_delta", "claims", claimIndex, field], message: "Train claim timestamp must precede the holdout cutoff." });
        }
      }
    }
    for (const [evidenceIndex, evidence] of delta.memory_delta.evidence.entries()) {
      if (evidence.observed_at !== null && Date.parse(evidence.observed_at) >= Date.parse(bundle.split.cutoff_at)) {
        context.addIssue({ code: "custom", path: ["memory", "deltas", index, "memory_delta", "evidence", evidenceIndex, "observed_at"], message: "Train evidence timestamp must precede the holdout cutoff." });
      }
    }
  }
  if (bundle.memory.cards !== claimCount) {
    context.addIssue({ code: "custom", path: ["memory", "cards"], message: "Memory card count must equal projected claim count." });
  }
  for (const [index, checkpoint] of bundle.evaluation.checkpoints.entries()) {
    if (Date.parse(checkpoint.source_completed_at) < Date.parse(bundle.split.cutoff_at)) {
      context.addIssue({ code: "custom", path: ["evaluation", "checkpoints", index, "source_completed_at"], message: "Holdout checkpoint must complete at or after the cutoff." });
    }
  }
});

export type CodexSessionMetadata = z.infer<typeof CodexSessionMetadataSchema>;
export type CodexCompletedTurn = z.infer<typeof CodexCompletedTurnSchema>;
export type CodexSessionTranscript = z.infer<typeof CodexSessionTranscriptSchema>;
export type RealReplayCheckpointSpec = z.infer<typeof RealReplayCheckpointSpecSchema>;
export type RealReplayBundle = z.infer<typeof RealReplayBundleSchema>;
export type RealReplayCheckpoint = RealReplayBundle["evaluation"]["checkpoints"][number];

export type RealReplayMode = "no_memory" | "full_memory_os";
export const REAL_REPLAY_MODES = ["no_memory", "full_memory_os"] as const satisfies readonly RealReplayMode[];

export function parseRealReplayCheckpointSpec(input: unknown): RealReplayCheckpointSpec {
  return RealReplayCheckpointSpecSchema.parse(input);
}

export function parseRealReplayBundle(input: unknown): RealReplayBundle {
  return RealReplayBundleSchema.parse(input);
}
