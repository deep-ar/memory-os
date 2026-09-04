---
name: memory-reflection
description: Convert meaningful completed work into atomic, linked, evidence-backed MemoryOS knowledge. Use at milestones, handoffs, major discoveries or failures, user corrections, significant tests, context compaction, and session end; do not use for routine progress logging, transcript storage, or automatic session summaries.
---

# Memory Reflection

Create one coherent `MemoryDelta` that adds durable knowledge to a project knowledge graph. MemoryOS stores what is known, why it is believed, where it applies, and how it relates to other knowledge. It is not a transcript archive or task diary.

## Role in the memory workflow

This skill owns write-side curation only. `memory-orchestrator` decides when project work needs recall, verification, or reflection; `memory-retrieval` supplies task-time knowledge and a verification ledger. Retrieval alone is not a reason to write, and this skill does not use stored knowledge as a substitute for checking current code or runtime behavior.

When current work confirms, narrows, contradicts, or obsoletes retrieved knowledge, preserve that outcome as Evidence and an explicit Claim relationship when it passes the admission gate. Do not silently rewrite history.

## Boundary

Use an explicit logical `project_id`. Never infer project identity only from `cwd`, a repository path, or a worktree. If no project id is configured or supplied, do not write memory.

The current session, task, turn, and agent are provenance. Do not create them as primary knowledge anchors unless the project is genuinely about those entities.

The agent owns semantic judgment. MemoryOS validates, stores, relates, and retrieves knowledge; it must not be asked to decide truth, summarize a transcript, resolve contradictions, or promote confidence automatically.

## Knowledge model

Build a connected graph from these elements:

- **Concept**: a stable domain anchor such as a component, subsystem, artifact, environment, decision, problem, procedure, constraint, or externally relevant entity.
- **Claim**: one falsifiable proposition about one or two Concepts. Prefer a typed subject-predicate-object relation when the knowledge is relational.
- **Evidence**: the concrete basis for a Claim, such as a test, benchmark, code location, commit, document, log, user statement, or tool result.
- **Context**: the conditions under which a Claim is valid, such as runtime, version, platform, environment, branch, build, or deployment mode.
- **Claim relations**: explicit epistemic links such as `supports`, `contradicts`, `supersedes`, `refines`, and `derived_from`.

Use stable domain identities. Reuse existing Concepts and predicates before creating new ones. Do not use session-turn identifiers as the semantic identity of facts.

## Admission gate

Store a candidate only when it has likely future reuse value and at least one of these is true:

- it records an architectural or product decision and its rationale;
- it captures a non-obvious problem, cause, fix, or prevention rule;
- it preserves a failed approach whose failure conditions matter later;
- it records a durable constraint, invariant, compatibility boundary, or user decision;
- it captures verified behavior, a meaningful measurement, or environment-specific behavior;
- it describes reusable know-how, including preconditions, success signals, and failure signals;
- it records a hypothesis that future work must validate;
- it creates a stable navigation anchor needed to connect other durable knowledge.

Do not store routine commands, temporary progress, ordinary compiler errors, trivial edits, intermediate reasoning, full transcripts, broad session conclusions, or information useful only for the next step. Do not duplicate facts that are cheap to obtain from the current code graph unless the relationship is a durable anchor for decisions, problems, history, or know-how.

## Compaction checkpoint

At a context-compaction checkpoint, assessment is mandatory but writing is not. Evaluate only durable knowledge added since the latest successful reflection in the session; do not turn the compacted context or transcript into a summary record.

Classify the completed work before applying the admission gate:

- **Isolated local change:** normally write nothing. Admit it only when the work exposed a reusable invariant, non-obvious cause, compatibility boundary, or broadly useful procedure.
- **Cross-module or system change:** treat decisions, ownership boundaries, invariants, problem-cause-fix links, and changed system behavior as candidates. Scope each Claim to the affected version, branch, build, environment, or runtime where necessary.
- **Unfinished investigation:** admit only costly-to-reconstruct observations or hypotheses that would materially improve continuation. Use `hypothesis` with `tentative`, preserve an explicitly incomplete Context, and record the next validation needed. Do not store unsupported speculation or routine investigative progress.
- **Concluded investigation:** explicit user approval or a command to implement establishes the selected direction and is Evidence for intent or decision. It does not prove technical correctness. Preserve the underlying code, test, log, runtime, or document Evidence for each factual conclusion.
- **Implemented fix or feature:** source or diff Evidence proves what changed. Tests, builds, runtime observations, benchmarks, or device checks separately establish behavior. Never promote a behavioral Claim to `verified` from a patch alone.

Use the current compacted context first. Read the session transcript only when needed to recover an exact user decision, tool observation, or evidence locator. Keep the transcript path and session identity as provenance; never store the transcript itself as semantic memory.

## Claim construction

Apply all of these rules:

1. Write one proposition per Claim. Split bullet lists, multi-part conclusions, and mixed fact/rationale/fix statements.
2. Never prefix a Claim with `Task:`, `Session:`, `Conclusion:`, or copied user/assistant dialogue.
3. Make the subject explicit and the statement understandable without the originating conversation.
4. Prefer relations over prose. For example, represent membership as several `HAS_MEMBER` relations and derive the count at query time instead of storing a paragraph containing both the list and the count.
5. Reuse an established predicate. If none exists, choose one clear `UPPER_SNAKE_CASE` predicate and avoid synonyms that express the same relation.
6. Keep decisions, problems, procedures, and constraints as stable Concepts when other knowledge must connect to them.
7. Connect decisions to their scope, selected option, rejected alternative when important, rationale, addressed problem, and validation evidence.
8. Connect problems to symptoms, affected Concepts, reproduction Contexts, causes, resolutions, and prevention rules when supported.
9. Connect know-how to its goal, prerequisites, applicable Contexts, success signals, failure signals, and authoritative runbook. Keep lengthy operational steps in project documentation and store a pointer plus the durable rules.
10. Store aggregate values only when they are independently meaningful measurements or historical snapshots; otherwise store the underlying relations from which they can be derived.

A generic connected result may have this shape:

```text
project --HAS_COMPONENT--> component
problem --AFFECTS--> component
problem --CAUSED_BY--> cause
decision --RESOLVES--> problem
decision --APPLIES_TO--> context
decision --REQUIRES--> constraint
claim --SUPPORTED_BY--> evidence
```

The names above illustrate graph shape, not a mandatory project ontology.

## Evidence and epistemic state

- Attach concrete Evidence to every non-trivial factual Claim.
- Treat an agent's previous conclusion as a source report, not proof of everything it states. Prefer its underlying test, code, log, benchmark, or user-decision evidence.
- Use `hypothesis` with `tentative` for an untested explanation.
- Use `observed` only for directly observed behavior and `tested` only for a representative test.
- Use `code_derived` for a conclusion established from current code and attach code evidence.
- Use `decision` for an intentional choice and preserve its rationale and scope.
- Use `user_asserted` for a factual user statement unless it is an explicit project decision or constraint.
- Do not generalize a contextual observation. A measurement without its relevant environment, version, build, or workload is incomplete.
- Do not upgrade confidence merely because the same unsourced conclusion appears in several summaries.

## Reflection workflow

1. Call `memory.get_context` for the explicit project and the completed work. Retain its `projectRevision`.
2. List candidate durable knowledge internally and apply the admission gate before creating graph entities.
3. Call `memory.find_concepts` for each proposed anchor. Reuse a stable id only when it denotes the same domain entity; similarity alone is not permission to merge.
4. Call `memory.search` for related active, disputed, historical, and superseded Claims as appropriate.
5. Call `memory.explain_claim` when evidence, provenance, validity, Context, or relations affect the new conclusion.
6. Convert accepted candidates into atomic Claims and connect them to stable Concepts, Contexts, Evidence, and related Claims.
7. Call `memory.find_conflicts` for each materially new or changed Claim. Distinguish duplicate knowledge, refinement, temporal change, contextual difference, and genuine contradiction.
8. Submit one coherent `memory.apply_delta` with the latest `projectRevision` as `expected_revision` and complete reflection provenance.

Do not append a new Claim when the result merely restates existing knowledge. Reuse the existing graph, attach new Evidence where the contract allows it, or create an explicit refinement, contradiction, or superseding Claim.

## Lifecycle and concurrency

The current create-only `MemoryDelta` contract cannot rewrite an existing Claim. When correction requires an unavailable update, invalidation, or promotion operation, preserve the new evidence and relationship without pretending the old Claim was mutated, and report the remaining lifecycle operation.

If `memory.apply_delta` returns `MEMORY_CONFLICT`, do not retry the same payload with a different revision. Fetch current memory, inspect intervening changes, rerun reconciliation, and construct a fresh coherent delta. Stop if the evidence no longer supports the intended write.

Finish with a short account of the Concepts, Claims, relations, Contexts, and Evidence stored; identify preserved uncertainty or conflict; and state what should instead be promoted into code, tests, configuration, or project documentation.
