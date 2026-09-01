import type { BenchmarkDataset } from "../domain/dataset.js";
import { parseDataset } from "../domain/dataset.js";
import type { RealReplayBundle } from "../real-replay/model.js";
import type { SemanticKnowledgeSpec } from "./model.js";

function compiledEvidenceId(sourceId: string): string {
  return `source:${sourceId}`;
}

function compactEvidenceSummary(evidence: { readonly summary: string; readonly result: string | null }): string {
  const outcome = evidence.result?.replace(/\s+/gu, " ").trim();
  if (outcome === undefined || outcome.length === 0) return evidence.summary;
  const limit = 240;
  return outcome.length <= limit ? `Recorded outcome: ${outcome}` : `Recorded outcome: ${outcome.slice(0, limit - 1)}…`;
}

function historicalEpistemicState(claim: SemanticKnowledgeSpec["claims"][number]): Pick<
  SemanticKnowledgeSpec["claims"][number],
  "epistemic_basis" | "confidence_level"
> {
  if (["decision", "user_asserted", "inferred", "hypothesis", "source_reported"].includes(claim.epistemic_basis)) {
    return { epistemic_basis: claim.epistemic_basis, confidence_level: claim.confidence_level };
  }
  return { epistemic_basis: "source_reported", confidence_level: "supported" };
}

export function compileSemanticDataset(input: {
  readonly spec: SemanticKnowledgeSpec;
  readonly sourceBundle: RealReplayBundle;
  readonly sourceBundleSha256: string;
}): BenchmarkDataset {
  if (input.spec.source_bundle_sha256 !== input.sourceBundleSha256) {
    throw new Error(`Semantic spec expects source bundle ${input.spec.source_bundle_sha256}, received ${input.sourceBundleSha256}.`);
  }
  const sourceEvidence = new Map(input.sourceBundle.memory.deltas.flatMap((delta) => (
    delta.memory_delta.evidence.map((evidence) => [evidence.id, evidence] as const)
  )));
  const requestedEvidenceIds = [...new Set(input.spec.claims.flatMap((claim) => claim.evidence_refs))];
  const missing = requestedEvidenceIds.filter((id) => !sourceEvidence.has(id));
  if (missing.length > 0) {
    throw new Error(`Semantic spec references Evidence outside the train projection: ${missing.join(", ")}.`);
  }
  const projectId = input.spec.project.id;
  const dataset = {
    schema_version: 1 as const,
    id: input.spec.id,
    version: input.spec.version,
    title: input.spec.title,
    profile: "controlled-v0.1" as const,
    projects: [{
      id: projectId,
      name: input.spec.project.name,
      description: input.spec.project.description,
      repository_uri: input.spec.project.repository_uri,
    }],
    deltas: [{
      id: `${input.spec.id}-semantic-reflection`,
      project_id: projectId,
      memory_delta: {
        expected_revision: 0,
        reflection: {
          agent_id: "memoryos-bench",
          agent_type: "memory-reflection-semantic-curator",
          session_id: null,
          task_id: input.spec.id,
          workspace_id: "D:/Projects/LucyCocos",
          worktree_id: null,
          branch: null,
          commit: null,
          trigger: "manual" as const,
        },
        concepts: input.spec.concepts.map((concept) => ({ ...concept, project_id: projectId })),
        claims: input.spec.claims.map((claim) => {
          const epistemic = historicalEpistemicState(claim);
          return {
            id: claim.id,
            project_id: projectId,
            subject_id: claim.subject_id,
            predicate: claim.predicate,
            object_id: claim.object_id,
            statement: claim.statement,
            ...epistemic,
            lifecycle_status: claim.lifecycle_status,
            valid_from: claim.valid_from,
            valid_to: claim.valid_to,
            last_verified_at: null,
            context_ids: claim.context_ids,
            evidence_ids: claim.evidence_refs.map(compiledEvidenceId),
            supports: claim.supports,
            contradicts: claim.contradicts,
            supersedes: claim.supersedes,
            refines: claim.refines,
            derived_from: claim.derived_from,
          };
        }),
        evidence: requestedEvidenceIds.map((sourceId) => {
          const evidence = sourceEvidence.get(sourceId);
          if (evidence === undefined) throw new Error(`Missing source Evidence '${sourceId}'.`);
          return {
            ...evidence,
            id: compiledEvidenceId(sourceId),
            project_id: projectId,
            summary: compactEvidenceSummary(evidence),
          };
        }),
        contexts: input.spec.contexts.map((context) => ({ ...context, project_id: projectId })),
      },
    }],
    probes: input.spec.questions.map((question) => ({
      id: question.id,
      track: question.track,
      project_id: projectId,
      query: {
        text: question.question,
        max_results: question.max_results,
        graph_depth: question.graph_depth,
      },
      gold: {
        relevant: [
          ...question.relevant_concept_ids.map((entity_id) => ({ entity_type: "concept" as const, entity_id, relevance: 2 })),
          ...question.relevant_claim_ids.map((entity_id) => ({ entity_type: "claim" as const, entity_id, relevance: 3 })),
        ],
        forbidden: [],
      },
    })),
  };
  return parseDataset(dataset);
}
