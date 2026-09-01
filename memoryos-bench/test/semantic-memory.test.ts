import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RealReplayBundle } from "../src/real-replay/model.js";
import { compileSemanticDataset } from "../src/semantic/compile-semantic-dataset.js";
import { compileSemanticIncrement } from "../src/semantic/compile-semantic-increment.js";
import { parseSemanticKnowledgeIncrementSpec, parseSemanticKnowledgeSpec } from "../src/semantic/model.js";

const bundleHash = "a".repeat(64);

function sourceBundle(): RealReplayBundle {
  return {
    memory: {
      deltas: [{
        memory_delta: {
          evidence: [{
            id: "evidence-source-1",
            project_id: "old-project",
            type: "test",
            summary: "A representative test established the relationship.",
            content: null,
            source_uri: "codex-session://train#turn-1",
            repo: "D:/Projects/example",
            commit: "abc123",
            branch: "main",
            file: "test/example.test.ts",
            symbol: null,
            line_start: null,
            line_end: null,
            command: "npm test",
            result: "passed",
            quote: null,
            observed_at: "2026-08-01T00:00:00.000Z",
            retrieved_at: null,
            content_hash: "b".repeat(64),
          }],
        },
      }],
    },
  } as unknown as RealReplayBundle;
}

function validSpec() {
  return {
    schema_version: 1,
    id: "semantic-test",
    version: "0.1.0",
    title: "Semantic knowledge test",
    source_bundle_sha256: bundleHash,
    project: {
      id: "semantic-project",
      name: "Semantic project",
      description: "Project with connected semantic memory.",
      repository_uri: "file:///example",
    },
    concepts: [
      { id: "component:loader", canonical_name: "Asset loader", description: null, concept_type: "component", aliases: [] },
      { id: "constraint:atomic", canonical_name: "Atomic persistence", description: null, concept_type: "constraint", aliases: [] },
    ],
    claims: [{
      id: "claim:loader-requires-atomic",
      subject_id: "component:loader",
      predicate: "REQUIRES",
      object_id: "constraint:atomic",
      statement: "The asset loader requires atomic persistence.",
      epistemic_basis: "tested",
      confidence_level: "verified",
      lifecycle_status: "active",
      valid_from: null,
      valid_to: null,
      last_verified_at: "2026-08-01T00:00:00.000Z",
      context_ids: [],
      evidence_refs: ["evidence-source-1"],
      supports: [],
      contradicts: [],
      supersedes: [],
      refines: [],
      derived_from: [],
    }],
    contexts: [],
    questions: [{
      id: "question:atomic-loader",
      track: "semantic",
      question: "What persistence rule protects the loader?",
      max_results: 10,
      graph_depth: 2,
      relevant_concept_ids: ["component:loader", "constraint:atomic"],
      relevant_claim_ids: ["claim:loader-requires-atomic"],
    }],
  };
}

describe("semantic session knowledge compilation", () => {
  it("compiles atomic domain knowledge and train Evidence into a benchmark dataset", () => {
    const dataset = compileSemanticDataset({
      spec: parseSemanticKnowledgeSpec(validSpec()),
      sourceBundle: sourceBundle(),
      sourceBundleSha256: bundleHash,
    });
    const delta = dataset.deltas[0]!.memory_delta;
    expect(delta.claims[0]?.predicate).toBe("REQUIRES");
    expect(delta.claims[0]).toMatchObject({ epistemic_basis: "source_reported", confidence_level: "supported", last_verified_at: null });
    expect(delta.claims[0]?.evidence_ids).toEqual(["source:evidence-source-1"]);
    expect(delta.evidence[0]?.project_id).toBe("semantic-project");
    expect(dataset.probes[0]?.gold.relevant.map((item) => item.entity_id)).toContain("claim:loader-requires-atomic");
  });

  it("rejects transcript-shaped Claims and session-shaped semantic anchors", () => {
    const transcriptClaim = structuredClone(validSpec());
    transcriptClaim.claims[0]!.statement = "Task: investigate\nConclusion: everything passed";
    expect(() => parseSemanticKnowledgeSpec(transcriptClaim)).toThrow(/transcript framing|compact proposition/u);

    const sessionAnchor = structuredClone(validSpec());
    sessionAnchor.concepts[0]!.id = "session:train";
    expect(() => parseSemanticKnowledgeSpec(sessionAnchor)).toThrow(/domain anchors/u);
  });

  it("rejects Evidence that is absent from the train bundle", () => {
    const spec = validSpec();
    spec.claims[0]!.evidence_refs = ["evidence-holdout-only"];
    expect(() => compileSemanticDataset({
      spec: parseSemanticKnowledgeSpec(spec),
      sourceBundle: sourceBundle(),
      sourceBundleSha256: bundleHash,
    })).toThrow(/outside the train projection/u);
  });

  it("requires explicit provenance links for inferred Claims", () => {
    const spec = validSpec();
    spec.claims[0]!.epistemic_basis = "inferred";
    expect(() => parseSemanticKnowledgeSpec(spec)).toThrow(/identify the Claims/u);
  });
});

describe("semantic increment compilation", () => {
  function incrementSpec() {
    return {
      schema_version: 1,
      id: "semantic-increment-test",
      version: "0.2.0",
      title: "Pinned semantic increment",
      project_id: "semantic-project",
      expected_revision: 1,
      base_spec_sha256: "c".repeat(64),
      source_session: {
        session_id: "root-source",
        completed_prefix_sha256: "PLACEHOLDER",
        completed_turns: 2,
      },
      concepts: [{ id: "problem:lost-prefab", canonical_name: "Lost prefab", description: null, concept_type: "problem", aliases: [] }],
      claims: [{
        id: "claim:lost-prefab-cause",
        subject_id: "problem:lost-prefab",
        predicate: "CAUSED_BY",
        object_id: "component:loader",
        statement: "Detaching prefab metadata before materialization removes reachable renderer data.",
        epistemic_basis: "observed",
        confidence_level: "verified",
        lifecycle_status: "active",
        valid_from: null,
        valid_to: null,
        last_verified_at: "2026-08-02T00:00:00.000Z",
        context_ids: [],
        evidence_refs: ["turn-2"],
        supports: [],
        contradicts: [],
        supersedes: [],
        refines: [],
        derived_from: [],
      }],
      contexts: [],
      questions: [{
        id: "question:lost-prefab",
        track: "technical",
        question: "Why did prefab renderers disappear?",
        max_results: 10,
        graph_depth: 2,
        relevant_concept_ids: ["problem:lost-prefab"],
        relevant_claim_ids: ["claim:lost-prefab-cause"],
      }],
    };
  }

  const transcript = {
    metadata: {
      session_id: "root-source",
      source_path: "C:/sessions/root-source.jsonl",
      started_at: "2026-08-01T00:00:00.000Z",
      observed_size_bytes: 1234,
      observed_sha256: "d".repeat(64),
      branch: "main",
      commit: "abc123",
      completed_turns: 2,
      aborted_turns: 1,
      last_completed_at: "2026-08-02T00:00:00.000Z",
      source_kind: "root" as const,
    },
    turns: [{ index: 1, user_message: "Hold this out", assistant_message: "Not selected", completed_at: "2026-08-01T00:00:00.000Z" }, {
      index: 2,
      user_message: "Why did renderers disappear?",
      assistant_message: "Prefab metadata was detached before materialization.",
      completed_at: "2026-08-02T00:00:00.000Z",
    }],
  };

  it("accepts references to base anchors and emits only selected completed-turn Evidence", () => {
    const spec = incrementSpec();
    spec.source_session.completed_prefix_sha256 = createHash("sha256").update(JSON.stringify(transcript.turns)).digest("hex");
    const dataset = compileSemanticIncrement({
      spec: parseSemanticKnowledgeIncrementSpec(spec),
      baseSpec: parseSemanticKnowledgeSpec(validSpec()),
      baseSpecSha256: "c".repeat(64),
      sourceSession: transcript,
    });
    const delta = dataset.deltas[0]!.memory_delta;
    expect(delta.expected_revision).toBe(1);
    expect(delta.claims[0]).toMatchObject({ object_id: "component:loader", epistemic_basis: "source_reported", last_verified_at: null });
    expect(delta.evidence).toHaveLength(1);
    expect(delta.evidence[0]?.source_uri).toBe("codex-session://root-source#turn-2");
    expect(delta.evidence[0]?.content).toBeNull();
    expect(delta.evidence[0]?.result).toBe("Prefab metadata was detached before materialization.");
  });

  it("rejects a changed source session snapshot", () => {
    const spec = incrementSpec();
    spec.source_session.completed_prefix_sha256 = createHash("sha256").update(JSON.stringify(transcript.turns)).digest("hex");
    const changed = structuredClone(transcript);
    changed.turns[1]!.assistant_message = "Changed completed result";
    expect(() => compileSemanticIncrement({
      spec: parseSemanticKnowledgeIncrementSpec(spec),
      baseSpec: parseSemanticKnowledgeSpec(validSpec()),
      baseSpecSha256: "c".repeat(64),
      sourceSession: changed,
    })).toThrow(/pinned increment snapshot/u);
  });
});
