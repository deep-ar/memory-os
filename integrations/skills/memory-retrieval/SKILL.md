---
name: memory-retrieval
description: Retrieve connected, evidence-aware MemoryOS knowledge for project work that depends on prior decisions, rationale, failures, constraints, validated behavior, or other context expensive to reconstruct. Do not use as a substitute for cheap inspection of current code or for trivial self-contained source questions.
---

# Memory Retrieval

Recover the smallest connected knowledge subgraph that makes the current task safer or cheaper. Memory is prior knowledge with provenance, scope, and possible drift; it is not an automatically current source of truth.

## Boundary

Use an explicit logical `project_id`. Never infer project identity only from `cwd`, a repository path, or a worktree. If the project is unknown, do not query another project's memory.

This skill owns read-side recall. It does not create or mutate Concepts, Claims, Evidence, Contexts, or lifecycle state. Route durable confirmations, corrections, refinements, contradictions, and new knowledge to `memory-reflection` after the work reaches an appropriate checkpoint.

Respect an explicit source constraint. If the user requests an answer only from memory, do not fill gaps from code, general knowledge, or inference. State what memory does not contain. If the user forbids memory use, do not query it.

## MemoryOS versus current sources

Choose the cheapest authoritative source for the question.

Use CodeGraph or direct source inspection for current, cheaply recoverable facts such as:

- what a specific function currently does;
- callers, callees, symbols, imports, and control flow;
- an exact constant, schema field, configuration value, or implementation branch;
- behavior that one focused source query answers without reconstructing project history.

Use MemoryOS for knowledge whose reconstruction is non-local or expensive, such as:

- architectural and product decisions, rationale, and rejected alternatives;
- cross-module or cross-artifact behavior established by substantial analysis;
- user constraints and compatibility boundaries;
- recurring problems, root causes, failed approaches, fixes, and prevention rules;
- runtime, device, deployment, benchmark, or visual evidence;
- historical evolution and the distinction between introduced, enabled, and integrated;
- know-how whose value lies in prerequisites, failure signals, or operational experience.

Use both when the task asks whether the current implementation still matches an intended architecture, past decision, or validated behavior. MemoryOS supplies the costly semantic frame and likely anchors; CodeGraph, current files, tests, runtime evidence, or primary external documentation establish current truth.

Do not duplicate cheap code facts into the working context merely because MemoryOS returned them. Use them as navigation hints and inspect the current source when they materially affect the task.

## Context budget

Memory must not crowd out the user's request, current code, tool evidence, and reasoning.

- Start narrow: normally allocate 2,000–4,000 tokens to the first `memory.get_context` call.
- Expand to 8,000 tokens for a multi-anchor architectural, historical, or root-cause task.
- Treat 16,000 tokens as the ordinary retrieval ceiling, not the default.
- Memory-derived material must not exceed 25% of the usable working context. When the remaining context is unknown, use the absolute limits above and compact before expanding.
- Use the backend maximum of 32,000 only for an explicit memory audit or dedicated reconstruction task where memory itself is the primary object of work.

Prefer several focused iterations over one maximum-size dump. Preserve Claim ids and a compact verification ledger; discard irrelevant prose and duplicate paths.

## Iterative recall

1. State the task and current Context precisely: project, branch or build when known, runtime, platform, environment, and relevant time boundary.
2. Split a broad task into two to five domain anchors. Use `memory.find_concepts` when names or identities are ambiguous.
3. Call `memory.get_context` with the task description, current Context, and the initial token budget. Retain `projectRevision` and whether the result was truncated.
4. Inspect the returned graph, not just ranked prose. Identify the core Concepts, active Claims, decisions, problems, constraints, Evidence summaries, Contexts, and claim relations.
5. Use `memory.search` for a missing branch, a specific time or lifecycle state, or a narrower technical phrase. Start with graph depth 1; use depth 2 for a necessary multi-hop relation. Use depth 3 only for a targeted historical or causal reconstruction.
6. Call `memory.explain_claim` for every Claim that may materially change a plan, answer, code change, or expensive action. Inspect provenance, Evidence, Context, confidence, lifecycle, supporting and contradicting Claims, and reflection history.
7. Use `memory.history` when the question is about evolution rather than current state.
8. Stop when the task is answerable, the next expansion repeats existing anchors, remaining branches are irrelevant, or verification outside memory is now cheaper than more retrieval.

Do not follow every graph edge. Expand a branch only when it can change the answer, decision, risk, or verification plan.

## Trust and freshness

Treat confidence, lifecycle, Context, and age as separate dimensions.

- `active` describes lifecycle, not freshness.
- `established` or `decision` records intentional authority, but does not prove that current code still implements the decision.
- `verified` or `tested` is strong only for the recorded version, environment, workload, and time.
- `supported`, `source_reported`, or `code_derived` historical knowledge is useful for navigation but requires a current check before it governs new work.
- `tentative` or `hypothesis` may guide investigation but must not be presented as fact.
- `disputed` requires the competing Claims and Evidence to be surfaced.
- `historical`, `superseded`, and `invalidated` Claims are excluded from current conclusions unless the task explicitly asks for history.
- A Context mismatch lowers applicability even when the Claim itself remains valid elsewhere.

Assume possible drift when related code changed after the Evidence commit, the branch or build differs, a runtime or dependency version changed, the external system is mutable, a later user correction exists, or a current check fails.

## Verification before reliance

Every retrieved Claim that materially influences a downstream recommendation, implementation, or decision must be handled explicitly:

1. **Confirm** it at the cheapest authoritative boundary: current CodeGraph/source/configuration, a focused test or runtime check, primary external documentation, or the user when intent is authoritative.
2. **Refine** its scope when the current Context is narrower or different.
3. **Correct or contradict** it when current evidence disagrees.
4. **Leave it unverified** only as a labeled investigation lead or a memory-derived statement in a read-only answer. An unverified Claim must not determine a downstream action; stop, ask, or choose a safer evidence-gathering step when verification is disproportionate.

Do not silently treat memory as current after detecting drift. Do not silently discard a conflicting Claim either; preserve the discrepancy for reflection.

Deletion is exceptional. Prefer historical traceability through correction, contradiction, supersession, or invalidation. Delete only when retention has no legitimate audit value or policy requires erasure, and only through an authorized operation.

## Retrieval result

Carry forward a compact ledger containing:

- the Claim ids that matter;
- the relevant Context and lifecycle state;
- why each Claim is applicable;
- verification status: `confirmed`, `refined`, `contradicted`, or `unverified`;
- gaps or conflicts that can change the outcome.

If memory has no relevant knowledge, say so and switch to the appropriate current source unless the user required a memory-only answer. Never invent the missing link.
