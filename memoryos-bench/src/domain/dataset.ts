import { z } from "zod";

const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const NullableTextSchema = z.string().min(1).nullable().default(null);
const NullableInstantSchema = z.string().datetime({ offset: true }).nullable().default(null);

export const EntityIdentitySchema = z.object({
  entity_type: z.enum(["concept", "claim", "evidence"]),
  entity_id: IdSchema,
  relevance: z.number().min(0).max(3).optional(),
}).strict();

const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  description: z.string().min(1).nullable().optional(),
  repository_uri: z.string().min(1).nullable().optional(),
}).strict();

const ProjectEntitySchema = z.object({ id: IdSchema, project_id: IdSchema });

export const ConceptWireSchema = ProjectEntitySchema.extend({
  canonical_name: z.string().min(1),
  description: NullableTextSchema,
  concept_type: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
}).strict();

export const ClaimWireSchema = ProjectEntitySchema.extend({
  subject_id: IdSchema,
  predicate: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/u),
  object_id: IdSchema.nullable().default(null),
  statement: z.string().min(1),
  epistemic_basis: z.enum([
    "hypothesis", "inferred", "observed", "tested", "source_reported",
    "user_asserted", "code_derived", "decision",
  ]),
  confidence_level: z.enum(["tentative", "supported", "verified", "established"]),
  lifecycle_status: z.enum(["active", "disputed", "superseded", "invalidated", "historical"]),
  valid_from: NullableInstantSchema,
  valid_to: NullableInstantSchema,
  last_verified_at: NullableInstantSchema,
  context_ids: z.array(IdSchema).default([]),
  evidence_ids: z.array(IdSchema).default([]),
  supports: z.array(IdSchema).default([]),
  contradicts: z.array(IdSchema).default([]),
  supersedes: z.array(IdSchema).default([]),
  refines: z.array(IdSchema).default([]),
  derived_from: z.array(IdSchema).default([]),
}).strict();

export const EvidenceWireSchema = ProjectEntitySchema.extend({
  type: z.enum([
    "test", "benchmark", "experiment", "code", "web_source", "documentation",
    "user_statement", "agent_observation", "log", "tool_result",
  ]),
  summary: z.string().min(1),
  content: NullableTextSchema,
  source_uri: NullableTextSchema,
  repo: NullableTextSchema,
  commit: NullableTextSchema,
  branch: NullableTextSchema,
  file: NullableTextSchema,
  symbol: NullableTextSchema,
  line_start: z.number().int().nonnegative().nullable().default(null),
  line_end: z.number().int().nonnegative().nullable().default(null),
  command: NullableTextSchema,
  result: NullableTextSchema,
  quote: NullableTextSchema,
  observed_at: NullableInstantSchema,
  retrieved_at: NullableInstantSchema,
  content_hash: NullableTextSchema,
}).strict();

export const ContextWireSchema = ProjectEntitySchema.extend({
  name: z.string().min(1),
  description: NullableTextSchema,
  dimensions: z.object({
    operating_system: NullableTextSchema,
    application: NullableTextSchema,
    runtime: NullableTextSchema,
    runtime_version: NullableTextSchema,
    framework: NullableTextSchema,
    framework_version: NullableTextSchema,
    platform: NullableTextSchema,
    environment: NullableTextSchema,
  }).strict(),
  concept_ids: z.array(IdSchema).default([]),
}).strict();

export const WireMemoryDeltaSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  reflection: z.object({
    agent_id: NullableTextSchema,
    agent_type: NullableTextSchema,
    session_id: NullableTextSchema,
    task_id: NullableTextSchema,
    workspace_id: NullableTextSchema,
    worktree_id: NullableTextSchema,
    branch: NullableTextSchema,
    commit: NullableTextSchema,
    trigger: z.enum([
      "task_complete", "milestone", "context_compaction", "handoff", "major_failure",
      "major_discovery", "user_correction", "significant_test", "session_end", "manual",
    ]),
  }).strict(),
  concepts: z.array(ConceptWireSchema).default([]),
  claims: z.array(ClaimWireSchema).default([]),
  evidence: z.array(EvidenceWireSchema).default([]),
  contexts: z.array(ContextWireSchema).default([]),
}).strict().refine(
  (delta) => delta.concepts.length + delta.claims.length + delta.evidence.length + delta.contexts.length > 0,
  "A benchmark MemoryDelta must contain at least one entity.",
);

export const DatasetSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  profile: z.literal("controlled-v0.1"),
  projects: z.array(ProjectSchema).min(1),
  deltas: z.array(z.object({
    id: IdSchema,
    project_id: IdSchema,
    memory_delta: WireMemoryDeltaSchema,
  }).strict()).min(1),
  probes: z.array(z.object({
    id: IdSchema,
    track: z.enum(["exact", "semantic", "technical", "context", "isolation"]),
    project_id: IdSchema,
    query: z.object({
      text: z.string().min(1),
      context: z.object({
        operating_system: z.string().min(1).nullable().optional(),
        application: z.string().min(1).nullable().optional(),
        runtime: z.string().min(1).nullable().optional(),
        runtime_version: z.string().min(1).nullable().optional(),
        framework: z.string().min(1).nullable().optional(),
        framework_version: z.string().min(1).nullable().optional(),
        platform: z.string().min(1).nullable().optional(),
        environment: z.string().min(1).nullable().optional(),
      }).strict().nullable().optional(),
      include: z.object({
        active: z.boolean().optional(),
        disputed: z.boolean().optional(),
        historical: z.boolean().optional(),
        superseded: z.boolean().optional(),
        invalidated: z.boolean().optional(),
      }).strict().optional(),
      time: z.object({
        at: z.string().datetime({ offset: true }).nullable().optional(),
        from: z.string().datetime({ offset: true }).nullable().optional(),
        to: z.string().datetime({ offset: true }).nullable().optional(),
      }).strict().optional(),
      max_results: z.number().int().min(1).max(100).default(10),
      graph_depth: z.number().int().min(0).max(3).default(1),
    }).strict(),
    gold: z.object({
      relevant: z.array(EntityIdentitySchema).min(1),
      forbidden: z.array(EntityIdentitySchema).default([]),
    }).strict(),
  }).strict()).min(1),
}).strict().superRefine((dataset, context) => {
  const projectIds = new Set<string>();
  for (const [index, project] of dataset.projects.entries()) {
    if (projectIds.has(project.id)) {
      context.addIssue({ code: "custom", path: ["projects", index, "id"], message: `Duplicate project '${project.id}'.` });
    }
    projectIds.add(project.id);
  }

  const operationIds = new Set<string>();
  const entityProjects = new Map<string, string>();
  for (const [index, delta] of dataset.deltas.entries()) {
    if (!projectIds.has(delta.project_id)) {
      context.addIssue({ code: "custom", path: ["deltas", index, "project_id"], message: `Unknown project '${delta.project_id}'.` });
    }
    if (operationIds.has(delta.id)) {
      context.addIssue({ code: "custom", path: ["deltas", index, "id"], message: `Duplicate delta '${delta.id}'.` });
    }
    operationIds.add(delta.id);
    const entities = [...delta.memory_delta.concepts, ...delta.memory_delta.claims,
      ...delta.memory_delta.evidence, ...delta.memory_delta.contexts];
    for (const entity of entities) {
      if (entity.project_id !== delta.project_id) {
        context.addIssue({ code: "custom", path: ["deltas", index], message: `Entity '${entity.id}' belongs to another project.` });
      }
    }
    const rankedEntities = [
      ...delta.memory_delta.concepts.map((entity) => ({ entity_type: "concept" as const, entity })),
      ...delta.memory_delta.claims.map((entity) => ({ entity_type: "claim" as const, entity })),
      ...delta.memory_delta.evidence.map((entity) => ({ entity_type: "evidence" as const, entity })),
    ];
    for (const rankedEntity of rankedEntities) {
      const key = identityKey({ entity_type: rankedEntity.entity_type, entity_id: rankedEntity.entity.id });
      if (entityProjects.has(key)) {
        context.addIssue({ code: "custom", path: ["deltas", index], message: `Duplicate ranked entity '${key}'.` });
      } else {
        entityProjects.set(key, rankedEntity.entity.project_id);
      }
    }
  }

  const probeIds = new Set<string>();
  for (const [index, probe] of dataset.probes.entries()) {
    if (!projectIds.has(probe.project_id)) {
      context.addIssue({ code: "custom", path: ["probes", index, "project_id"], message: `Unknown project '${probe.project_id}'.` });
    }
    if (probeIds.has(probe.id)) {
      context.addIssue({ code: "custom", path: ["probes", index, "id"], message: `Duplicate probe '${probe.id}'.` });
    }
    probeIds.add(probe.id);
    const relevant = new Set<string>();
    for (const item of probe.gold.relevant) {
      const key = identityKey(item);
      if (relevant.has(key)) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold", "relevant"], message: `Duplicate relevant entity '${key}'.` });
      }
      relevant.add(key);
      if (entityProjects.get(key) !== probe.project_id) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold", "relevant"], message: `Relevant entity '${key}' is not declared in project '${probe.project_id}'.` });
      }
    }
    const forbiddenKeys = new Set<string>();
    for (const forbidden of probe.gold.forbidden) {
      const key = identityKey(forbidden);
      if (forbiddenKeys.has(key)) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold", "forbidden"], message: `Duplicate forbidden entity '${key}'.` });
      }
      forbiddenKeys.add(key);
      if (relevant.has(key)) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold"], message: "An entity cannot be both relevant and forbidden." });
      }
      if (!entityProjects.has(key)) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold", "forbidden"], message: `Forbidden entity '${key}' is not declared.` });
      } else if (probe.track === "isolation" && entityProjects.get(key) === probe.project_id) {
        context.addIssue({ code: "custom", path: ["probes", index, "gold", "forbidden"], message: `Isolation forbidden entity '${key}' must belong to another project.` });
      }
    }
  }
});

export type BenchmarkDataset = z.infer<typeof DatasetSchema>;
export type BenchmarkProject = BenchmarkDataset["projects"][number];
export type BenchmarkDelta = BenchmarkDataset["deltas"][number];
export type SearchProbe = BenchmarkDataset["probes"][number];
export type EntityIdentity = z.infer<typeof EntityIdentitySchema>;

export function parseDataset(input: unknown): BenchmarkDataset {
  return DatasetSchema.parse(input);
}

export function identityKey(identity: Pick<EntityIdentity, "entity_type" | "entity_id">): string {
  return `${identity.entity_type}:${identity.entity_id}`;
}
