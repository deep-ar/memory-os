import { z } from "zod";

const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const SemanticIdSchema = IdSchema.refine(
  (value) => !/(?:^|[-_:/])(session|turn)(?:$|[-_:/])/iu.test(value),
  "Semantic knowledge ids must name domain anchors, not sessions or turns.",
);

const InstantSchema = z.string().datetime({ offset: true });

const ConceptSpecSchema = z.object({
  id: SemanticIdSchema,
  canonical_name: z.string().min(1).max(200),
  description: z.string().min(1).max(600).nullable().default(null),
  concept_type: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1).max(200)).default([]),
}).strict();

const ClaimSpecSchema = z.object({
  id: SemanticIdSchema,
  subject_id: SemanticIdSchema,
  predicate: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  object_id: SemanticIdSchema.nullable().default(null),
  statement: z.string().min(1).max(600)
    .refine((value) => !/(?:^|\n)\s*(?:Task|Session|Conclusion):/iu.test(value), "Claims must not contain transcript framing.")
    .refine((value) => !/[\r\n]/u.test(value), "Claims must contain one compact proposition, not a multi-line summary."),
  epistemic_basis: z.enum([
    "hypothesis", "inferred", "observed", "tested", "source_reported",
    "user_asserted", "code_derived", "decision",
  ]),
  confidence_level: z.enum(["tentative", "supported", "verified", "established"]),
  lifecycle_status: z.enum(["active", "disputed", "superseded", "invalidated", "historical"]).default("active"),
  valid_from: InstantSchema.nullable().default(null),
  valid_to: InstantSchema.nullable().default(null),
  last_verified_at: InstantSchema.nullable().default(null),
  context_ids: z.array(SemanticIdSchema).default([]),
  evidence_refs: z.array(IdSchema).min(1),
  supports: z.array(SemanticIdSchema).default([]),
  contradicts: z.array(SemanticIdSchema).default([]),
  supersedes: z.array(SemanticIdSchema).default([]),
  refines: z.array(SemanticIdSchema).default([]),
  derived_from: z.array(SemanticIdSchema).default([]),
}).strict().refine((claim) => claim.predicate !== "RECORDED_CONCLUSION", {
  message: "Transcript conclusions are evidence sources, not semantic Claims.",
  path: ["predicate"],
});

const ContextSpecSchema = z.object({
  id: SemanticIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(600).nullable().default(null),
  dimensions: z.object({
    operating_system: z.string().min(1).nullable().default(null),
    application: z.string().min(1).nullable().default(null),
    runtime: z.string().min(1).nullable().default(null),
    runtime_version: z.string().min(1).nullable().default(null),
    framework: z.string().min(1).nullable().default(null),
    framework_version: z.string().min(1).nullable().default(null),
    platform: z.string().min(1).nullable().default(null),
    environment: z.string().min(1).nullable().default(null),
  }).strict(),
  concept_ids: z.array(SemanticIdSchema).default([]),
}).strict();

const QuestionSpecSchema = z.object({
  id: SemanticIdSchema,
  track: z.enum(["exact", "semantic", "technical", "context"]),
  question: z.string().min(1).max(2_000),
  max_results: z.number().int().min(1).max(100).default(20),
  graph_depth: z.number().int().min(0).max(3).default(2),
  relevant_concept_ids: z.array(SemanticIdSchema).default([]),
  relevant_claim_ids: z.array(SemanticIdSchema).min(1),
  retrieval_queries: z.array(z.string().min(1).max(2_000)).min(1).max(6).optional(),
}).strict();

export const SemanticKnowledgeSpecSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  source_bundle_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  project: z.object({
    id: SemanticIdSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(600),
    repository_uri: z.string().min(1),
  }).strict(),
  concepts: z.array(ConceptSpecSchema).min(1),
  claims: z.array(ClaimSpecSchema).min(1),
  contexts: z.array(ContextSpecSchema).default([]),
  questions: z.array(QuestionSpecSchema).min(1),
}).strict().superRefine((spec, refinement) => {
  const conceptIds = new Set<string>();
  const claimIds = new Set<string>();
  const contextIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const [index, concept] of spec.concepts.entries()) {
    if (conceptIds.has(concept.id)) refinement.addIssue({ code: "custom", path: ["concepts", index, "id"], message: `Duplicate Concept '${concept.id}'.` });
    conceptIds.add(concept.id);
  }
  for (const [index, context] of spec.contexts.entries()) {
    if (contextIds.has(context.id)) refinement.addIssue({ code: "custom", path: ["contexts", index, "id"], message: `Duplicate Context '${context.id}'.` });
    contextIds.add(context.id);
    for (const conceptId of context.concept_ids) {
      if (!conceptIds.has(conceptId)) refinement.addIssue({ code: "custom", path: ["contexts", index, "concept_ids"], message: `Unknown Concept '${conceptId}'.` });
    }
  }
  for (const [index, claim] of spec.claims.entries()) {
    if (claimIds.has(claim.id)) refinement.addIssue({ code: "custom", path: ["claims", index, "id"], message: `Duplicate Claim '${claim.id}'.` });
    claimIds.add(claim.id);
    if (!conceptIds.has(claim.subject_id)) refinement.addIssue({ code: "custom", path: ["claims", index, "subject_id"], message: `Unknown subject Concept '${claim.subject_id}'.` });
    if (claim.object_id !== null && !conceptIds.has(claim.object_id)) refinement.addIssue({ code: "custom", path: ["claims", index, "object_id"], message: `Unknown object Concept '${claim.object_id}'.` });
    for (const contextId of claim.context_ids) {
      if (!contextIds.has(contextId)) refinement.addIssue({ code: "custom", path: ["claims", index, "context_ids"], message: `Unknown Context '${contextId}'.` });
    }
  }
  for (const [index, claim] of spec.claims.entries()) {
    for (const relatedId of [...claim.supports, ...claim.contradicts, ...claim.supersedes, ...claim.refines, ...claim.derived_from]) {
      if (!claimIds.has(relatedId)) refinement.addIssue({ code: "custom", path: ["claims", index], message: `Unknown related Claim '${relatedId}'.` });
    }
    if (claim.epistemic_basis === "inferred" && claim.derived_from.length === 0) {
      refinement.addIssue({
        code: "custom",
        path: ["claims", index, "derived_from"],
        message: "An inferred Claim must identify the Claims from which it was derived.",
      });
    }
  }
  for (const [index, question] of spec.questions.entries()) {
    if (questionIds.has(question.id)) refinement.addIssue({ code: "custom", path: ["questions", index, "id"], message: `Duplicate question '${question.id}'.` });
    questionIds.add(question.id);
    for (const conceptId of question.relevant_concept_ids) {
      if (!conceptIds.has(conceptId)) refinement.addIssue({ code: "custom", path: ["questions", index, "relevant_concept_ids"], message: `Unknown relevant Concept '${conceptId}'.` });
    }
    for (const claimId of question.relevant_claim_ids) {
      if (!claimIds.has(claimId)) refinement.addIssue({ code: "custom", path: ["questions", index, "relevant_claim_ids"], message: `Unknown relevant Claim '${claimId}'.` });
    }
  }
});

export type SemanticKnowledgeSpec = z.infer<typeof SemanticKnowledgeSpecSchema>;

export const SemanticKnowledgeIncrementSpecSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  project_id: SemanticIdSchema,
  expected_revision: z.number().int().nonnegative(),
  base_spec_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  source_session: z.object({
    session_id: IdSchema,
    completed_prefix_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    completed_turns: z.number().int().positive(),
  }).strict(),
  concepts: z.array(ConceptSpecSchema).min(1),
  claims: z.array(ClaimSpecSchema).min(1),
  contexts: z.array(ContextSpecSchema).default([]),
  questions: z.array(QuestionSpecSchema).min(1),
}).strict().superRefine((spec, refinement) => {
  const collections = [
    ["concepts", spec.concepts],
    ["claims", spec.claims],
    ["contexts", spec.contexts],
    ["questions", spec.questions],
  ] as const;
  for (const [name, entities] of collections) {
    const ids = new Set<string>();
    for (const [index, entity] of entities.entries()) {
      if (ids.has(entity.id)) {
        refinement.addIssue({ code: "custom", path: [name, index, "id"], message: `Duplicate ${name} id '${entity.id}'.` });
      }
      ids.add(entity.id);
    }
  }
  for (const [index, claim] of spec.claims.entries()) {
    if (claim.epistemic_basis === "inferred" && claim.derived_from.length === 0) {
      refinement.addIssue({
        code: "custom",
        path: ["claims", index, "derived_from"],
        message: "An inferred Claim must identify the Claims from which it was derived.",
      });
    }
  }
});

export type SemanticKnowledgeIncrementSpec = z.infer<typeof SemanticKnowledgeIncrementSpecSchema>;

export function parseSemanticKnowledgeSpec(input: unknown): SemanticKnowledgeSpec {
  return SemanticKnowledgeSpecSchema.parse(input);
}

export function parseSemanticKnowledgeIncrementSpec(input: unknown): SemanticKnowledgeIncrementSpec {
  return SemanticKnowledgeIncrementSpecSchema.parse(input);
}
