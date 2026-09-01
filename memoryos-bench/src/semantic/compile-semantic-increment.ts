import { createHash } from "node:crypto";
import type { BenchmarkDataset } from "../domain/dataset.js";
import { parseDataset } from "../domain/dataset.js";
import type { CodexCompletedTurn, CodexSessionTranscript } from "../real-replay/model.js";
import type { SemanticKnowledgeIncrementSpec, SemanticKnowledgeSpec } from "./model.js";

const TURN_EVIDENCE_PATTERN = /^turn-(\d+)$/u;

function historicalEpistemicState(claim: SemanticKnowledgeIncrementSpec["claims"][number]) {
  if (["decision", "user_asserted", "inferred", "hypothesis", "source_reported"].includes(claim.epistemic_basis)) {
    return { epistemic_basis: claim.epistemic_basis, confidence_level: claim.confidence_level };
  }
  return { epistemic_basis: "source_reported" as const, confidence_level: "supported" as const };
}

function evidenceId(sessionId: string, turn: number): string {
  return `source:${sessionId}:turn-${String(turn).padStart(4, "0")}`;
}

function sourceTurn(ref: string): number {
  const match = TURN_EVIDENCE_PATTERN.exec(ref);
  if (match === null) throw new Error(`Increment Evidence reference '${ref}' must use turn-N format.`);
  return Number(match[1]);
}

function compactOutcome(turn: CodexCompletedTurn): string {
  const outcome = turn.assistant_message.replace(/\s+/gu, " ").trim();
  const summary = outcome.length === 0 ? turn.user_message.replace(/\s+/gu, " ").trim() : outcome;
  const limit = 240;
  return summary.length <= limit ? `Recorded outcome: ${summary}` : `Recorded outcome: ${summary.slice(0, limit - 1)}…`;
}

function compactEvidenceResult(value: string): string | null {
  const withoutMemoryFooter = value.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu, "");
  const normalized = withoutMemoryFooter.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
  if (normalized.length === 0) return null;
  const limit = 2_000;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function validateReferences(input: {
  readonly spec: SemanticKnowledgeIncrementSpec;
  readonly baseSpec: SemanticKnowledgeSpec;
}): void {
  const baseConceptIds = new Set(input.baseSpec.concepts.map((concept) => concept.id));
  const baseClaimIds = new Set(input.baseSpec.claims.map((claim) => claim.id));
  const baseContextIds = new Set(input.baseSpec.contexts.map((context) => context.id));
  const newConceptIds = new Set(input.spec.concepts.map((concept) => concept.id));
  const newClaimIds = new Set(input.spec.claims.map((claim) => claim.id));
  const newContextIds = new Set(input.spec.contexts.map((context) => context.id));
  const duplicates = [
    ...input.spec.concepts.filter((entity) => baseConceptIds.has(entity.id)).map((entity) => entity.id),
    ...input.spec.claims.filter((entity) => baseClaimIds.has(entity.id)).map((entity) => entity.id),
    ...input.spec.contexts.filter((entity) => baseContextIds.has(entity.id)).map((entity) => entity.id),
  ];
  if (duplicates.length > 0) throw new Error(`Increment redefines base entities: ${duplicates.join(", ")}.`);

  const conceptIds = new Set([...baseConceptIds, ...newConceptIds]);
  const claimIds = new Set([...baseClaimIds, ...newClaimIds]);
  const contextIds = new Set([...baseContextIds, ...newContextIds]);
  for (const context of input.spec.contexts) {
    for (const conceptId of context.concept_ids) {
      if (!conceptIds.has(conceptId)) throw new Error(`Context '${context.id}' references unknown Concept '${conceptId}'.`);
    }
  }
  for (const claim of input.spec.claims) {
    if (!conceptIds.has(claim.subject_id)) throw new Error(`Claim '${claim.id}' references unknown subject Concept '${claim.subject_id}'.`);
    if (claim.object_id !== null && !conceptIds.has(claim.object_id)) {
      throw new Error(`Claim '${claim.id}' references unknown object Concept '${claim.object_id}'.`);
    }
    for (const contextId of claim.context_ids) {
      if (!contextIds.has(contextId)) throw new Error(`Claim '${claim.id}' references unknown Context '${contextId}'.`);
    }
    for (const relatedId of [...claim.supports, ...claim.contradicts, ...claim.supersedes, ...claim.refines, ...claim.derived_from]) {
      if (!claimIds.has(relatedId)) throw new Error(`Claim '${claim.id}' references unknown related Claim '${relatedId}'.`);
    }
  }
  for (const question of input.spec.questions) {
    for (const conceptId of question.relevant_concept_ids) {
      if (!newConceptIds.has(conceptId)) throw new Error(`Increment question '${question.id}' must rank a new Concept, received '${conceptId}'.`);
    }
    for (const claimId of question.relevant_claim_ids) {
      if (!newClaimIds.has(claimId)) throw new Error(`Increment question '${question.id}' must rank a new Claim, received '${claimId}'.`);
    }
  }
}

export function compileSemanticIncrement(input: {
  readonly spec: SemanticKnowledgeIncrementSpec;
  readonly baseSpec: SemanticKnowledgeSpec;
  readonly baseSpecSha256: string;
  readonly sourceSession: CodexSessionTranscript;
}): BenchmarkDataset {
  if (input.spec.base_spec_sha256 !== input.baseSpecSha256) {
    throw new Error(`Increment expects base spec ${input.spec.base_spec_sha256}, received ${input.baseSpecSha256}.`);
  }
  if (input.spec.project_id !== input.baseSpec.project.id) throw new Error("Increment project does not match the base semantic project.");
  const pin = input.spec.source_session;
  const metadata = input.sourceSession.metadata;
  const completedPrefixSha256 = createHash("sha256").update(JSON.stringify(input.sourceSession.turns)).digest("hex");
  if (pin.session_id !== metadata.session_id || pin.completed_prefix_sha256 !== completedPrefixSha256
    || pin.completed_turns !== metadata.completed_turns) {
    throw new Error("Source session no longer matches the pinned increment snapshot.");
  }
  validateReferences(input);

  const turnsByIndex = new Map(input.sourceSession.turns.map((turn) => [turn.index, turn] as const));
  const requestedTurns = [...new Set(input.spec.claims.flatMap((claim) => claim.evidence_refs.map(sourceTurn)))];
  const missingTurns = requestedTurns.filter((turn) => !turnsByIndex.has(turn));
  if (missingTurns.length > 0) throw new Error(`Increment references unavailable completed turns: ${missingTurns.join(", ")}.`);
  const projectId = input.spec.project_id;
  const dataset = {
    schema_version: 1 as const,
    id: input.spec.id,
    version: input.spec.version,
    title: input.spec.title,
    profile: "controlled-v0.1" as const,
    projects: [{
      id: projectId,
      name: input.baseSpec.project.name,
      description: input.baseSpec.project.description,
      repository_uri: input.baseSpec.project.repository_uri,
    }],
    deltas: [{
      id: `${input.spec.id}-reflection`,
      project_id: projectId,
      memory_delta: {
        expected_revision: input.spec.expected_revision,
        reflection: {
          agent_id: "memoryos-bench",
          agent_type: "memory-reflection-semantic-increment-curator",
          session_id: metadata.session_id,
          task_id: input.spec.id,
          workspace_id: "D:/Projects/LucyCocos",
          worktree_id: null,
          branch: metadata.branch,
          commit: null,
          trigger: "manual" as const,
        },
        concepts: input.spec.concepts.map((concept) => ({ ...concept, project_id: projectId })),
        claims: input.spec.claims.map((claim) => ({
          id: claim.id,
          project_id: projectId,
          subject_id: claim.subject_id,
          predicate: claim.predicate,
          object_id: claim.object_id,
          statement: claim.statement,
          ...historicalEpistemicState(claim),
          lifecycle_status: claim.lifecycle_status,
          valid_from: claim.valid_from,
          valid_to: claim.valid_to,
          last_verified_at: null,
          context_ids: claim.context_ids,
          evidence_ids: claim.evidence_refs.map((ref) => evidenceId(metadata.session_id, sourceTurn(ref))),
          supports: claim.supports,
          contradicts: claim.contradicts,
          supersedes: claim.supersedes,
          refines: claim.refines,
          derived_from: claim.derived_from,
        })),
        evidence: requestedTurns.map((turnIndex) => {
          const turn = turnsByIndex.get(turnIndex)!;
          const content = `${turn.user_message}\n\n${turn.assistant_message}`;
          return {
            id: evidenceId(metadata.session_id, turnIndex),
            project_id: projectId,
            type: "agent_observation" as const,
            summary: compactOutcome(turn),
            content: null,
            source_uri: `codex-session://${metadata.session_id}#turn-${turnIndex}`,
            repo: "D:/Projects/LucyCocos",
            commit: null,
            branch: metadata.branch,
            file: null,
            symbol: null,
            line_start: null,
            line_end: null,
            command: null,
            result: compactEvidenceResult(turn.assistant_message),
            quote: null,
            observed_at: turn.completed_at,
            retrieved_at: null,
            content_hash: createHash("sha256").update(content).digest("hex"),
          };
        }),
        contexts: input.spec.contexts.map((context) => ({ ...context, project_id: projectId })),
      },
    }],
    probes: input.spec.questions.map((question) => ({
      id: question.id,
      track: question.track,
      project_id: projectId,
      query: { text: question.question, max_results: question.max_results, graph_depth: question.graph_depth },
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
