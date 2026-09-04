---
name: memory-orchestrator
description: Coordinate MemoryOS retrieval, current-source verification, and reflection during non-trivial project work. Use when a task may depend on prior decisions or expensive project context, or may produce durable knowledge; skip for trivial, self-contained work with no history or learning value.
---

# Memory Orchestrator

Place memory retrieval and reflection at the right points in project work. Retrieval reduces rediscovery before consequential reasoning; reflection preserves durable learning after evidence exists. Neither process replaces current-source inspection or expands the user's authorization.

## Responsibilities

| Capability | Owns | Does not own |
|---|---|---|
| `memory-orchestrator` | deciding whether and when to retrieve, verify, or reflect | claim construction, graph traversal details, truth resolution |
| `memory-retrieval` | bounded iterative recall, graph expansion, trust assessment, verification ledger | writes or lifecycle mutation |
| `memory-reflection` | admission, reconciliation, and one coherent `MemoryDelta` | task-time recall policy or current implementation verification |
| CodeGraph/current tools | cheap current implementation and runtime evidence | historical rationale, user intent, or cross-session knowledge |

Read does not imply write. A task may retrieve useful knowledge without producing anything durable. A write does require read-side reconciliation with the existing graph.

## Intake routing

First honor explicit user constraints such as memory-only, no-memory, read-only, or no-file-change requests. Then establish the logical `project_id`; a path alone is insufficient.

Choose the route by information cost and authority:

| Task shape | Route |
|---|---|
| Exact current function, call path, symbol, constant, or local behavior | CodeGraph/current source first; usually no memory |
| Prior decision, rationale, known failure, compatibility rule, history, or user constraint | Memory retrieval before planning |
| Current implementation versus intended architecture or prior behavior | Memory retrieval, then current-source verification |
| Cross-module, scene, runtime, device, deployment, or performance behavior expensive to reconstruct | Memory retrieval for anchors and evidence, then targeted current checks |
| Mutable external fact | Memory for prior context if useful, then current primary source |
| Trivial or fully self-contained work | Neither retrieval nor reflection unless the user asks |

Mandatory retrieval triggers include a request for previous context, a recurring or regression bug, an architectural choice, a compatibility boundary, a historical distinction, a handoff, a high-cost diagnostic, or a decision whose wrong assumption would cause substantial rework.

Do not retrieve merely because MemoryOS is available. If current code answers the question cheaply and no rationale or history matters, use the code index.

## Work timeline

1. **Before planning:** retrieve when an intake trigger applies. Use `memory-retrieval` and keep its initial context budget small.
2. **After anchors emerge:** if current inspection reveals a named subsystem, prior workaround, unusual constraint, or contradiction, run a focused second retrieval rather than restarting broadly.
3. **Before a material decision:** verify every memory Claim that would govern architecture, implementation, deletion, migration, deployment, or a costly test. Use the retrieval verification ledger.
4. **During execution:** treat current source, tests, runtime, and user corrections as new evidence. Do not force them to agree with memory.
5. **At a durable checkpoint:** invoke `memory-reflection` only if the work produced reusable knowledge that passes its admission gate.
6. **Before final handoff:** report material memory assumptions and their verification status. If reflection ran, report what was stored and what remains uncertain or requires lifecycle correction.

Context compaction is a mandatory reflection assessment point, not a mandatory write point. When the runtime exposes a post-compaction continuation hook, use it to invoke `memory-reflection` in the same agent session so semantic judgment remains with the working agent. Do not start a second summarizer agent merely to ingest a transcript.

## Reflection triggers

Reflect after an architectural or product decision, a non-obvious root cause, a meaningful failed approach, a reusable procedure, a durable user constraint, a significant representative test, a correction to prior knowledge, a handoff, context compaction, or session end with durable learning.

Do not reflect routine progress, commands, ordinary build noise, intermediate hypotheses already resolved within the task, copied source facts, or a session summary.

When current evidence confirms memory without adding durable scope, evidence, or confidence, no write is necessary. When it materially strengthens, narrows, contradicts, or obsoletes a Claim, route the result to reflection.

## Drift and correction loop

If verification disagrees with memory:

1. pause reliance on the affected Claim;
2. determine whether the difference is temporal, contextual, a genuine contradiction, or an error;
3. continue only from current authoritative evidence;
4. invoke reflection with the old Claim id, new Evidence, Context, and relationship;
5. preserve history through refinement, contradiction, supersession, or invalidation when supported;
6. request authorized deletion only for exceptional retention or data-governance reasons.

The current create-only `MemoryDelta` may be unable to complete a lifecycle mutation. In that case, preserve the new evidence and explicit relationship, report the remaining operation, and never claim the old graph was rewritten.

## Failure rules

- If MemoryOS is unavailable, proceed from current sources only when the task remains safe; disclose that prior project knowledge was not checked.
- If prior decisions are necessary and cannot be recovered safely, stop and ask rather than inventing them.
- If the project id is ambiguous, do not query or write another project.
- If context budget is exhausted, compact to Claims, relations, and verification status before another retrieval.
- If the user requested a memory-only answer and memory is incomplete, return the known subset and the gap.
