# Architecture review — stage 4

Review date: 2026-08-30

Verdict: pass for the stage 4 agent-interface scope. No unresolved high-severity boundary or correctness issue remains.

## Reviewed boundaries

- `modules/memory-tools` owns agent-facing use cases and depends only on domain/retrieval/reflection ports.
- `transports/mcp` owns wire schemas, snake-case mapping, MCP results, and transport errors.
- `FalkorDbMemoryReadStore` owns exact graph reads; it does not contain MCP or orchestration policy.
- `runtime/create-runtime` is the composition root; infrastructure does not leak into business modules.
- Streamable HTTP creates a fresh MCP server per request. The stdio process is a forwarding proxy and does not connect to FalkorDB or Ollama.

The automated forbidden-import test confirms that `src/modules` imports neither Fastify, FalkorDB, MCP SDK, adapters, transports, nor environment state.

## Findings corrected during review

1. **High — optimistic revision was not discoverable.** `apply_delta` required `expected_revision`, but read tools did not expose the current project revision. `memory.search` and `memory.get_context` now return `projectRevision` from the primary Project node.
2. **High — conflict discovery was structurally incomplete.** The first implementation returned only same-subject-and-predicate candidates. The use case now combines same-subject graph candidates with hybrid semantic candidates and preserves context, time, and evidence summaries without resolving them.
3. **Medium — `get_claim` was not a full Claim.** Exact reads now include project id, outgoing claim relations, provenance, schema version, and claim revision.
4. **Medium — history filters could match entity id and entity type on different entities in one event.** Both predicates now apply to the same created entity; unfiltered project history still includes events without entity edges.
5. **Medium — task context was only claim-budgeted.** Compaction now estimates the complete returned subgraph while selecting claims and marks truncation explicitly.

## Replacement and concurrency properties

- MCP transport can be replaced without changing use cases.
- FalkorDB read, write, retrieval, and reindex adapters remain separate cohesive capabilities.
- Embedding provider remains replaceable through its port.
- Two MCP clients writing one project with the same revision produce one commit and one machine-readable `MEMORY_CONFLICT`.
- HTTP and stdio contract tests advertise the same eight canonical tools.

## Deliberate follow-up scope

- The current MemoryDelta is create-only. Update, refine, promote, supersede, invalidate, and restore operations remain later domain increments; the reflection skill states this boundary explicitly.
- Semantic conflict similarity is normalized hybrid RRF relevance, not a cross-encoder score. A reranker can replace this policy behind the use-case boundary.
- The runtime currently owns four lightweight FalkorDB clients, one per adapter capability. Pool sharing is an operational optimization, not a boundary correction.
