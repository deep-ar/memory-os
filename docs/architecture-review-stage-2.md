# Architecture review — storage foundation

Scope: implementation stages 1 and 2 plus the first embedding/RRF slice of stage 3.

## Architecture summary

- Knowledge owns entity types and invariants.
- Reflection owns MemoryDelta preparation, optimistic revision policy, and immutable event creation.
- Retrieval owns provider-neutral embedding identity and deterministic ranking.
- FalkorDB and Ollama are adapters behind application-owned ports.
- `main.ts` is the composition root; Fastify is transport-only.
- FalkorDB owns the primary graph/event state. Embeddings and search indexes remain derived state.

## Rubric

| Category | Score | Evidence |
| --- | ---: | --- |
| Business alignment | 2 | Modules follow Project/Knowledge/Reflection/Retrieval capabilities. |
| Cohesion | 2 | Domain validation, delta orchestration, storage translation, and embedding validation have separate owners. |
| Coupling | 2 | Domain/application modules have no Fastify, FalkorDB, Ollama, process, or adapter imports; this is guarded by a test. |
| Information hiding | 2 | Cypher, Ollama HTTP shapes, and RRF internals do not leak into domain contracts. |
| Replaceability | 2 | `MemoryWriteStore` and `EmbeddingProvider` are provider-neutral ports. |
| Abstraction quality | 2 | Ports cover actual storage/model volatility; no generic service/helper layer was introduced. |
| Testability | 2 | Domain and RRF run in-process; FalkorDB and Ollama have opt-in real integration tests. |
| Operational clarity | 1 | Atomicity, conflicts, configuration, model identity, and readiness are explicit; backup/restore and migration waiting remain later-stage work. |

## Findings

Resolved high:

- The initial Ollama adapter could associate a vector with a stale digest if a mutable model alias changed during a request. It now reads identity before and after generation and rejects the batch with `MODEL_CHANGED` if either digest or dimension changes.

Resolved medium:

- The first runtime image copied pnpm's virtual store without package links. The Dockerfile now uses a production `pnpm deploy`; an in-container import smoke-test proves runtime dependencies resolve.

Recorded medium, not a stage-2 blocker:

- Embeddings are not yet part of `apply_delta`; stage 3 must create derived documents/vectors and enforce index identity before that stage is complete.
- Full-text/vector/graph channel queries and temporal/context ranking are not implemented yet; only the provider and RRF core exist.
- Project registration is currently an adapter bootstrap operation, not yet a canonical application/CLI contract. It belongs to the agent-interface/CLI stages.

Recorded low:

- FalkorDB reports constraint creation asynchronously. Current integration tests prove repeated bootstrap and immediate writes on the pinned image, but a future migration runner should expose and wait for migration state explicitly.

## Accepted trade-offs

- Native host Ollama is preferred over an Ollama container to avoid duplicating a multi-gigabyte runtime/model and to simplify GPU access on Windows. The adapter boundary keeps a containerized or remote runtime replaceable.
- A modular monolith is appropriate for the local single-user deployment; separate services would add installation and failure complexity without an ownership benefit.

## Verdict

Stages 1–2: **pass**. Stage 3 and the complete product remain intentionally incomplete according to the implementation plan.

