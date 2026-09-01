import { z } from "zod";
import { ApplyMemoryDeltaInputSchema } from "../contracts/apply-memory-delta.js";

export const IdSchema = z.string().min(1).max(128);
const NullableInstantSchema = z.string().datetime({ offset: true }).nullable().optional();
const NullableStringSchema = z.string().min(1).nullable().optional();

export const ContextSchema = z.object({
  operating_system: NullableStringSchema,
  application: NullableStringSchema,
  runtime: NullableStringSchema,
  runtime_version: NullableStringSchema,
  framework: NullableStringSchema,
  framework_version: NullableStringSchema,
  platform: NullableStringSchema,
  environment: NullableStringSchema,
}).strict();

export const SearchInputSchema = z.object({
  project_id: IdSchema,
  query: z.string().min(1),
  context: ContextSchema.nullable().optional(),
  include: z.object({
    active: z.boolean().optional(),
    disputed: z.boolean().optional(),
    historical: z.boolean().optional(),
    superseded: z.boolean().optional(),
    invalidated: z.boolean().optional(),
  }).strict().optional(),
  time: z.object({
    at: NullableInstantSchema,
    from: NullableInstantSchema,
    to: NullableInstantSchema,
  }).strict().optional(),
  max_results: z.number().int().min(1).max(100).optional(),
  graph_depth: z.number().int().min(0).max(3).optional(),
}).strict();

export const GetContextInputSchema = z.object({
  project_id: IdSchema,
  task_description: z.string().min(1),
  current_context: ContextSchema.nullable().optional(),
  token_budget: z.number().int().min(256).max(32_000).nullable().optional(),
}).strict();

export const FindConceptsInputSchema = z.object({
  project_id: IdSchema,
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export const ClaimIdentityInputSchema = z.object({
  project_id: IdSchema,
  claim_id: IdSchema,
}).strict();

export const FindConflictsInputSchema = z.object({
  project_id: IdSchema,
  claim: z.object({
    subject_id: IdSchema,
    predicate: z.string().min(1),
    object_id: IdSchema.nullable().optional(),
    statement: z.string().min(1),
    context_ids: z.array(IdSchema).optional(),
    valid_from: NullableInstantSchema,
    valid_to: NullableInstantSchema,
  }).strict(),
}).strict();

export const HistoryInputSchema = z.object({
  project_id: IdSchema,
  entity_type: z.string().min(1).nullable().optional(),
  entity_id: IdSchema.nullable().optional(),
  from: NullableInstantSchema,
  to: NullableInstantSchema,
  limit: z.number().int().min(1).max(1_000).optional(),
}).strict();

export { ApplyMemoryDeltaInputSchema };
