# Architecture review — hybrid retrieval

Scope: stage 3 embedding pipeline, FalkorDB search indexes, hybrid retrieval, connected subgraphs, and reindexing.

## Architecture summary

- Reflection orchestrates validation, embedding preparation, and one atomic memory commit without knowing Ollama or Cypher.
- Retrieval owns document construction, embedding identity, RRF, epistemic/context ranking, temporal query policy, and reindex orchestration.
- `FalkorDbMemoryStore`, `FalkorDbRetrievalStore`, and `FalkorDbSearchIndexStore` are separate adapters for write transactions, query traversal, and index maintenance.
- The graph and event journal remain primary. Vectors, full-text indexes, and cached embedding text are rebuildable derivatives.
- One service-wide index identity prevents different projects or writers from mixing model digests.

## Rubric

| Category | Score | Evidence |
| --- | ---: | --- |
| Business alignment | 2 | Search, ranking, index identity, and reindex operations use specification terminology. |
| Cohesion | 2 | Write, retrieval, and maintenance adapters have independent responsibilities despite substantial Cypher bodies. |
| Coupling | 2 | Provider types remain inside adapters; architecture tests find no infrastructure imports in business modules. |
| Information hiding | 2 | Callers see `RetrievalStore` and `SearchIndexMaintenanceStore`, not FalkorDB nodes or procedures. |
| Replaceability | 2 | Ollama and FalkorDB can be replaced through business-oriented ports. |
| Abstraction quality | 2 | Each port protects an external or transactional boundary; there are no pass-through service layers. |
| Testability | 2 | Pure ranking/document tests, fake-port use-case tests, real adapter tests, and a live BGE-M3 multilingual fixture are present. |
| Operational clarity | 2 | Digest CAS, atomic reindex, UTC normalization, finite vectors, readiness degradation, and bounded graph traversal are explicit. |

## Findings

Resolved high:

- Reindex originally detected missing target nodes only after the update query. The compare-and-swap query now validates the complete target set before any vector or metadata mutation.
- Temporal filtering initially compared offset-bearing ISO strings lexicographically. Transport, persistence preparation, and search filters now normalize instants to UTC.

Resolved medium:

- Readiness previously compared only Ollama availability. It now reports `reindex_required` with HTTP 503 when the persistent index digest differs from the current model.

Recorded medium:

- A change in vector dimension is rejected before mutation. Supporting it requires a controlled vector-index drop/create migration and belongs to the migration/operations stage; ordinary BGE-M3 digest changes are fully reindexed now.

Recorded low:

- Claim embedding text uses stable subject/object/context IDs plus the full statement. Enriching references with canonical names may improve recall and can be measured later without changing contracts.

## Accepted trade-offs

- Graph traversal is bounded to depth 0–3 and implemented as deterministic breadth-first adapter queries. This protects a workstation service from accidental unbounded traversals.
- Candidate retrieval is capped at 300 before fusion. Pagination and larger offline analysis are separate use cases.
- A reranker remains optional; deterministic semantic + full-text + graph + RRF is the baseline.

## Checks

- strict TypeScript typecheck;
- 37 tests including real FalkorDB, real Ollama BGE-M3, cross-language retrieval, temporal filtering, concurrent writes, digest mismatch, and atomic reindex;
- production TypeScript build;
- automated forbidden-import architecture test.

## Verdict

Stage 3: **pass**. No critical or high findings remain.

