import { z } from "zod";
import type { ApplyMemoryDeltaCommand } from "../../modules/knowledge/index.js";

const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const NullableStringSchema = z.string().min(1).nullable().default(null);
const NullableDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .nullable()
  .default(null);

const ProjectEntitySchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
});

const ConceptSchema = ProjectEntitySchema.extend({
  canonical_name: z.string().min(1),
  description: NullableStringSchema,
  concept_type: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
}).strict();

const EvidenceSchema = ProjectEntitySchema.extend({
  type: z.enum([
    "test",
    "benchmark",
    "experiment",
    "code",
    "web_source",
    "documentation",
    "user_statement",
    "agent_observation",
    "log",
    "tool_result",
  ]),
  summary: z.string().min(1),
  content: NullableStringSchema,
  source_uri: NullableStringSchema,
  repo: NullableStringSchema,
  commit: NullableStringSchema,
  branch: NullableStringSchema,
  file: NullableStringSchema,
  symbol: NullableStringSchema,
  line_start: z.number().int().nonnegative().nullable().default(null),
  line_end: z.number().int().nonnegative().nullable().default(null),
  command: NullableStringSchema,
  result: NullableStringSchema,
  quote: NullableStringSchema,
  observed_at: NullableDateTimeSchema,
  retrieved_at: NullableDateTimeSchema,
  content_hash: NullableStringSchema,
}).strict();

const ContextDimensionsSchema = z
  .object({
    operating_system: NullableStringSchema,
    application: NullableStringSchema,
    runtime: NullableStringSchema,
    runtime_version: NullableStringSchema,
    framework: NullableStringSchema,
    framework_version: NullableStringSchema,
    platform: NullableStringSchema,
    environment: NullableStringSchema,
  })
  .strict()
  .default({
    operating_system: null,
    application: null,
    runtime: null,
    runtime_version: null,
    framework: null,
    framework_version: null,
    platform: null,
    environment: null,
  });

const ContextSchema = ProjectEntitySchema.extend({
  name: z.string().min(1),
  description: NullableStringSchema,
  dimensions: ContextDimensionsSchema,
  concept_ids: z.array(IdSchema).default([]),
}).strict();

const ClaimSchema = ProjectEntitySchema.extend({
  subject_id: IdSchema,
  predicate: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/u),
  object_id: IdSchema.nullable().default(null),
  statement: z.string().min(1),
  epistemic_basis: z.enum([
    "hypothesis",
    "inferred",
    "observed",
    "tested",
    "source_reported",
    "user_asserted",
    "code_derived",
    "decision",
  ]),
  confidence_level: z.enum(["tentative", "supported", "verified", "established"]),
  lifecycle_status: z.enum([
    "active",
    "disputed",
    "superseded",
    "invalidated",
    "historical",
  ]),
  valid_from: NullableDateTimeSchema,
  valid_to: NullableDateTimeSchema,
  last_verified_at: NullableDateTimeSchema,
  context_ids: z.array(IdSchema).default([]),
  evidence_ids: z.array(IdSchema).default([]),
  supports: z.array(IdSchema).default([]),
  contradicts: z.array(IdSchema).default([]),
  supersedes: z.array(IdSchema).default([]),
  refines: z.array(IdSchema).default([]),
  derived_from: z.array(IdSchema).default([]),
}).strict();

const ReflectionMetadataSchema = z
  .object({
    agent_id: NullableStringSchema,
    agent_type: NullableStringSchema,
    session_id: NullableStringSchema,
    task_id: NullableStringSchema,
    workspace_id: NullableStringSchema,
    worktree_id: NullableStringSchema,
    branch: NullableStringSchema,
    commit: NullableStringSchema,
    trigger: z.enum([
      "task_complete",
      "milestone",
      "context_compaction",
      "handoff",
      "major_failure",
      "major_discovery",
      "user_correction",
      "significant_test",
      "session_end",
      "manual",
    ]),
  })
  .strict();

const CreateMemoryDeltaSchema = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    reflection: ReflectionMetadataSchema,
    concepts: z.array(ConceptSchema).default([]),
    claims: z.array(ClaimSchema).default([]),
    evidence: z.array(EvidenceSchema).default([]),
    contexts: z.array(ContextSchema).default([]),
  })
  .strict()
  .superRefine((delta, context) => {
    if (
      delta.concepts.length +
        delta.claims.length +
        delta.evidence.length +
        delta.contexts.length ===
      0
    ) {
      context.addIssue({
        code: "custom",
        message: "A MemoryDelta must contain at least one operation",
      });
    }
  });

export const ApplyMemoryDeltaInputSchema = z
  .object({
    project_id: IdSchema,
    memory_delta: CreateMemoryDeltaSchema,
  })
  .strict();

export function parseApplyMemoryDeltaInput(input: unknown): ApplyMemoryDeltaCommand {
  const parsed = ApplyMemoryDeltaInputSchema.parse(input);

  return {
    projectId: parsed.project_id,
    delta: {
      expectedRevision: parsed.memory_delta.expected_revision,
      reflection: {
        agentId: parsed.memory_delta.reflection.agent_id,
        agentType: parsed.memory_delta.reflection.agent_type,
        sessionId: parsed.memory_delta.reflection.session_id,
        taskId: parsed.memory_delta.reflection.task_id,
        workspaceId: parsed.memory_delta.reflection.workspace_id,
        worktreeId: parsed.memory_delta.reflection.worktree_id,
        branch: parsed.memory_delta.reflection.branch,
        commit: parsed.memory_delta.reflection.commit,
        trigger: parsed.memory_delta.reflection.trigger,
      },
      concepts: parsed.memory_delta.concepts.map((item) => ({
        id: item.id,
        projectId: item.project_id,
        canonicalName: item.canonical_name,
        description: item.description,
        conceptType: item.concept_type,
        aliases: item.aliases,
      })),
      claims: parsed.memory_delta.claims.map((item) => ({
        id: item.id,
        projectId: item.project_id,
        subjectId: item.subject_id,
        predicate: item.predicate,
        objectId: item.object_id,
        statement: item.statement,
        epistemicBasis: item.epistemic_basis,
        confidenceLevel: item.confidence_level,
        lifecycleStatus: item.lifecycle_status,
        validFrom: item.valid_from,
        validTo: item.valid_to,
        lastVerifiedAt: item.last_verified_at,
        contextIds: item.context_ids,
        evidenceIds: item.evidence_ids,
        supports: item.supports,
        contradicts: item.contradicts,
        supersedes: item.supersedes,
        refines: item.refines,
        derivedFrom: item.derived_from,
      })),
      evidence: parsed.memory_delta.evidence.map((item) => ({
        id: item.id,
        projectId: item.project_id,
        type: item.type,
        summary: item.summary,
        content: item.content,
        sourceUri: item.source_uri,
        repo: item.repo,
        commit: item.commit,
        branch: item.branch,
        file: item.file,
        symbol: item.symbol,
        lineStart: item.line_start,
        lineEnd: item.line_end,
        command: item.command,
        result: item.result,
        quote: item.quote,
        observedAt: item.observed_at,
        retrievedAt: item.retrieved_at,
        contentHash: item.content_hash,
      })),
      contexts: parsed.memory_delta.contexts.map((item) => ({
        id: item.id,
        projectId: item.project_id,
        name: item.name,
        description: item.description,
        dimensions: {
          operatingSystem: item.dimensions.operating_system,
          application: item.dimensions.application,
          runtime: item.dimensions.runtime,
          runtimeVersion: item.dimensions.runtime_version,
          framework: item.dimensions.framework,
          frameworkVersion: item.dimensions.framework_version,
          platform: item.dimensions.platform,
          environment: item.dimensions.environment,
        },
        conceptIds: item.concept_ids,
      })),
    },
  };
}
