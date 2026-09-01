import { z } from "zod";
import {
  ClaimWireSchema,
  ConceptWireSchema,
  ContextWireSchema,
  EvidenceWireSchema,
  WireMemoryDeltaSchema,
} from "../domain/dataset.js";

const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

const PriorMemorySnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  concepts: z.array(ConceptWireSchema).default([]),
  claims: z.array(ClaimWireSchema).default([]),
  evidence: z.array(EvidenceWireSchema).default([]),
  contexts: z.array(ContextWireSchema).default([]),
}).strict();

const CuratorOutputSchema = z.object({
  memory_delta: WireMemoryDeltaSchema,
}).strict();

const CuratorEpisodeSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  phase: z.enum([
    "product_discovery", "architecture", "implementation", "testing", "deployment",
    "operations", "upgrade", "support",
  ]),
  timestamp: z.string().datetime({ offset: true }),
  context: z.record(z.string(), z.string().min(1).nullable()).default({}),
  input: z.object({ task: z.string().min(1) }).strict(),
  observations: z.array(z.object({
    id: IdSchema,
    type: z.enum(["benchmark", "tool_result", "code", "documentation", "user_statement", "agent_observation", "routine"]),
    data: z.unknown(),
  }).strict()).min(1),
  prior_memory: PriorMemorySnapshotSchema,
  gold_output: CuratorOutputSchema,
  evaluation: z.object({
    promotion_expected_claim_ids: z.array(IdSchema).default([]),
    promotion_forbidden_claim_ids: z.array(IdSchema).default([]),
  }).strict().default({
    promotion_expected_claim_ids: [],
    promotion_forbidden_claim_ids: [],
  }),
}).strict();

export const CuratorDatasetSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  profile: z.literal("curator-controlled-v0.1"),
  prompt_version: z.string().min(1),
  memory_skill_version: z.string().min(1),
  system_prompt: z.string().min(1),
  episodes: z.array(CuratorEpisodeSchema).min(1),
}).strict().superRefine((dataset, context) => {
  const episodeIds = new Set<string>();
  for (const [episodeIndex, episode] of dataset.episodes.entries()) {
    if (episodeIds.has(episode.id)) {
      context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "id"], message: `Duplicate episode '${episode.id}'.` });
    }
    episodeIds.add(episode.id);

    const observationIds = new Set<string>();
    for (const [observationIndex, observation] of episode.observations.entries()) {
      if (observationIds.has(observation.id)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "observations", observationIndex, "id"], message: `Duplicate observation '${observation.id}'.` });
      }
      observationIds.add(observation.id);
    }

    const groups = [
      ...episode.prior_memory.concepts,
      ...episode.prior_memory.claims,
      ...episode.prior_memory.evidence,
      ...episode.prior_memory.contexts,
      ...episode.gold_output.memory_delta.concepts,
      ...episode.gold_output.memory_delta.claims,
      ...episode.gold_output.memory_delta.evidence,
      ...episode.gold_output.memory_delta.contexts,
    ];
    for (const entity of groups) {
      if (entity.project_id !== episode.project_id) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Entity '${entity.id}' belongs to another project.` });
      }
    }
    if (episode.gold_output.memory_delta.expected_revision !== episode.prior_memory.revision) {
      context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "gold_output", "memory_delta", "expected_revision"], message: "Gold expected_revision must equal prior-memory revision." });
    }

    const knownConceptIds = new Set([
      ...episode.prior_memory.concepts.map((item) => item.id),
      ...episode.gold_output.memory_delta.concepts.map((item) => item.id),
    ]);
    const knownClaimIds = new Set([
      ...episode.prior_memory.claims.map((item) => item.id),
      ...episode.gold_output.memory_delta.claims.map((item) => item.id),
    ]);
    const knownEvidenceIds = new Set([
      ...episode.prior_memory.evidence.map((item) => item.id),
      ...episode.gold_output.memory_delta.evidence.map((item) => item.id),
    ]);
    const knownContextIds = new Set([
      ...episode.prior_memory.contexts.map((item) => item.id),
      ...episode.gold_output.memory_delta.contexts.map((item) => item.id),
    ]);
    const claimsToValidate = [...episode.prior_memory.claims, ...episode.gold_output.memory_delta.claims];
    for (const claim of claimsToValidate) {
      if (!knownConceptIds.has(claim.subject_id)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Claim '${claim.id}' has unknown subject '${claim.subject_id}'.` });
      }
      if (claim.object_id !== null && !knownConceptIds.has(claim.object_id)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Claim '${claim.id}' has unknown object '${claim.object_id}'.` });
      }
      for (const evidenceId of claim.evidence_ids) {
        if (!knownEvidenceIds.has(evidenceId)) {
          context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Claim '${claim.id}' links unknown evidence '${evidenceId}'.` });
        }
      }
      for (const contextId of claim.context_ids) {
        if (!knownContextIds.has(contextId)) {
          context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Claim '${claim.id}' links unknown context '${contextId}'.` });
        }
      }
      for (const relation of ["supports", "contradicts", "supersedes", "refines", "derived_from"] as const) {
        for (const targetId of claim[relation]) {
          if (!knownClaimIds.has(targetId)) {
            context.addIssue({ code: "custom", path: ["episodes", episodeIndex], message: `Claim '${claim.id}' has unknown ${relation} target '${targetId}'.` });
          }
        }
      }
    }

    const goldClaimIds = new Set(episode.gold_output.memory_delta.claims.map((claim) => claim.id));
    const expectedPromotion = new Set<string>();
    for (const claimId of episode.evaluation.promotion_expected_claim_ids) {
      if (expectedPromotion.has(claimId)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "evaluation"], message: `Duplicate expected promotion '${claimId}'.` });
      }
      expectedPromotion.add(claimId);
      if (!goldClaimIds.has(claimId)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "evaluation"], message: `Expected promotion '${claimId}' is not a gold claim.` });
      }
    }
    for (const claimId of episode.evaluation.promotion_forbidden_claim_ids) {
      if (expectedPromotion.has(claimId)) {
        context.addIssue({ code: "custom", path: ["episodes", episodeIndex, "evaluation"], message: `Claim '${claimId}' cannot be both expected and forbidden promotion.` });
      }
    }
  }
});

export type CuratorDataset = z.infer<typeof CuratorDatasetSchema>;
export type CuratorEpisode = CuratorDataset["episodes"][number];
export type CuratorOutput = z.infer<typeof CuratorOutputSchema>;
export type WireMemoryDelta = z.infer<typeof WireMemoryDeltaSchema>;

export function parseCuratorDataset(input: unknown): CuratorDataset {
  return CuratorDatasetSchema.parse(input);
}

export function parseCuratorOutput(input: unknown): CuratorOutput {
  return CuratorOutputSchema.parse(input);
}
