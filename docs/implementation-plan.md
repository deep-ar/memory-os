# Memory OS implementation plan

Current status (2026-08-30): stages 1–7 complete. The global local installation includes the canonical MCP interface, portable reflection skill, Paseo configuration, explicit project registration, lifecycle diagnostics, integrity-checked backup/restore, a versioned Admin API, and the React knowledge explorer.

## Stage 1 — foundation and executable domain slice

- create the pnpm/TypeScript workspace and Docker Compose topology;
- define public contracts for project registration and create-only MemoryDelta;
- implement domain validation, optimistic revision behavior, and an in-memory transactional adapter;
- prove atomic failure and immutable ReflectionEvent behavior with tests;
- expose service health/readiness endpoints.

Exit criteria: install, typecheck, tests, and production build succeed; the service starts without requiring FalkorDB for unit tests.

## Stage 2 — FalkorDB primary storage

- validate FalkorDB transaction and concurrency behavior;
- implement schema bootstrap/migrations;
- persist Projects, Concepts, Claims, Evidence, Contexts, and ReflectionEvents;
- implement atomic `apply_delta` with project revision compare-and-set;
- add adapter contract and real-container integration tests.

Exit criteria: concurrent writers produce one commit and one `MEMORY_CONFLICT`; restart preserves graph and event history.

## Stage 3 — retrieval and embeddings

- implement full-text, graph, temporal, and context retrieval;
- implement Ollama `/api/embed` adapter for BGE-M3;
- reject wrong-size, missing, or non-finite vectors;
- store model digest/version and implement reindexing;
- fuse channels with deterministic RRF and return connected subgraphs.

Exit criteria: multilingual retrieval fixtures pass and changing model identity cannot mix vectors in one index.

## Stage 4 — agent interface

- implement the canonical MCP tools;
- support Streamable HTTP and a thin stdio-to-HTTP proxy;
- provide structured output and machine-readable errors;
- package the reflection skill and Codex/Claude/Paseo integration adapters.

Exit criteria: the same contract passes end-to-end through both MCP transports and two simulated agents can share one project safely.

## Stage 5 — CLI and installation

- implement `memoryos up`, `status`, `doctor`, project initialization, integrations, backup, restore, and `mcp`;
- keep global connection settings outside project Git data;
- retain Docker volumes on normal stop/update operations.

Exit criteria: a new project can be connected to a running global installation without copying Compose files into the project.

Completed evidence: `memoryos status`, `doctor`, and idempotent explicit `project init` passed against the Docker service; backup produced a real FalkorDB RDB with a SHA-256 manifest and `redis-check-rdb` reported a valid checksum. Restore orchestration and tamper rejection are automated; destructive replacement of the live global database remains an explicitly confirmed operation.

## Stage 6 — React administration SPA

- implement project overview, search, Claim explanation, evidence, conflicts, and temporal history;
- keep mutations restricted to explicit administrative operations;
- serve the compiled SPA from the Memory OS service.

Exit criteria: Playwright covers the primary `WHY DO WE BELIEVE THIS?` flow and history remains inspectable.

Completed evidence: production Compose serves the React SPA from the Node service; Chrome E2E covers project selection, hybrid search, Claim detail, full Evidence, provenance, self-filtered conflict candidates, and immutable history with no page errors.

## Stage 7 — operational completion

- automated backup, restore, integrity validation, migrations, metrics, and tracing;
- security checks for localhost binding, Origin validation, authentication configuration, and secret redaction;
- architecture review and end-to-end acceptance against the formal specification.

Exit criteria: all architectural invariants have an automated or documented acceptance proof.

Completed evidence: the pinned real FalkorDB plus native Ollama/BGE-M3 suite passes serially; schema 0-to-1 migration and deliberately corrupted integrity fixtures are covered. Compose creates daily checksummed RDB snapshots with retention, and the produced artifact passed both SHA-256 and `redis-check-rdb`. Local-only defaults, optional mandatory Bearer authentication for external access, Host/Origin guards, domain-level secret rejection, audited Evidence hard-delete, lifecycle metrics, operation outcomes/latencies, and content-free `apply_delta` traces have automated coverage. Production `doctor`, `/api/v1/integrity`, `/metrics`, and Chrome E2E passed.
