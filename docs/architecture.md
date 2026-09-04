# Memory OS architecture

## Goal

Memory OS is a local-first, multi-project engineering memory shared by coding agents across sessions, branches, and worktrees. Agents own all epistemic decisions; the backend owns deterministic validation, persistence, retrieval, concurrency, provenance, and audit.

The first deployment target is Docker Compose on a developer workstation. Codex, Claude, Paseo, and other orchestrators interact through the same MCP contract.

## Scope

In scope:

- structured Projects, Concepts, Claims, Evidence, Contexts, and ReflectionEvents;
- immutable event history plus a current knowledge graph;
- atomic MemoryDelta writes with optimistic concurrency;
- semantic, full-text, graph, context, and temporal retrieval;
- Streamable HTTP MCP and a thin stdio proxy;
- local administration, backup, restore, migrations, and observability;
- a React SPA for inspection and explicit administrative operations.

Out of scope:

- transcript archiving or automatic transcript summarization;
- backend-owned contradiction resolution or confidence promotion;
- replacing Git, CodeGraph, project documentation, or tests;
- cloud multi-tenancy and horizontal scaling in the first release.

## Deployment

```text
Codex / Claude / Paseo
          |
   MCP HTTP or stdio
          |
          v
  Memory OS Service ------> native Ollama (BGE-M3 embeddings)
          |
          v
       FalkorDB
```

The deployable application is a modular Node.js service. Memory OS and FalkorDB run in Docker Compose; Ollama runs natively on the host by default to avoid a second multi-gigabyte runtime/model copy and to use the host GPU without Docker-specific configuration. The service reaches it through `host.docker.internal` (with a Linux host-gateway mapping). The compiled React SPA is served by the Memory OS service so the local installation does not require a separate web container.

## Modules

| Module | Responsibility | Owns | Does not own | Public API |
| --- | --- | --- | --- | --- |
| Projects | Stable project identity and isolation | Project metadata and revision | Worktree discovery policy | project commands and queries |
| Knowledge | Knowledge entities and epistemic/temporal invariants | Concepts, Claims, Evidence, Contexts | Persistence or transport | validated domain operations |
| Reflection | Atomic reconciliation of new knowledge | MemoryDelta policy and ReflectionEvent creation | Graph queries or MCP formatting | apply delta use case |
| Retrieval | Connected, explainable knowledge retrieval | Ranking and subgraph assembly policy | Embedding inference or FalkorDB syntax | search/context/explain queries |
| Knowledge map | Context-first human inspection projection | Canvas node selection, audit flags, deterministic priority and response limits | Cypher, React layout, or memory mutation | context catalog and context graph queries |
| History | Immutable audit and temporal views | Event interpretation and replay rules | Storage-specific journaling | history queries |
| MCP transport | Agent-facing protocol adapter | MCP schemas and result mapping | Epistemic decisions | canonical memory tools |
| Admin HTTP | Human-facing administration adapter | HTTP mapping and authorization | Domain policy | versioned REST API |
| FalkorDB adapter | Persistent graph and event journal | Cypher/storage mapping | Domain rules | storage ports |
| Ollama adapter | Dense embedding generation | Model call and response validation | Retrieval ranking | embedding port |
| CLI | Installation, lifecycle, project integration, stdio proxy | Local operational workflow | Memory semantics | `memoryos` command |

## Dependency direction

```text
MCP / Admin HTTP / CLI
          |
          v
Application use cases
          |
          v
Domain policies

FalkorDB and Ollama adapters implement ports declared by application modules.
Only the composition root selects concrete adapters.
```

Domain code must not import Fastify, MCP SDK, FalkorDB, Ollama, React, environment variables, or process APIs.

## Ports and adapters

| Port | Purpose | First adapter | Replacement boundary |
| --- | --- | --- | --- |
| MemoryWriteStore | Atomic delta commit and revision control | FalkorDB | Storage adapter and its tests |
| MemoryReadStore | Claim, history, and graph reads | FalkorDB | Storage adapter and query tests |
| KnowledgeMapReadStore | Context catalog and semantic graph source reads | FalkorDB | Knowledge-map adapter, wiring, and integration tests |
| EmbeddingProvider | Dense document/query embeddings | Ollama BGE-M3 | Embedding adapter, config, reindex |
| Clock | Transaction timestamps | System clock | Composition root/test fake |
| IdGenerator | Stable primary IDs | UUID | Composition root/test fake |

## Key decisions

- Node.js 24 LTS, TypeScript strict ESM, Fastify, Zod, pnpm workspaces.
- A modular monolith rather than microservices.
- One local Memory OS instance hosts many isolated projects.
- The project ID is explicit and version-controlled; cwd is never the identity.
- Event journal and current graph use one primary store unless the FalkorDB atomicity spike disproves that design.
- Ollama is a replaceable embedding runtime only. It performs no generative or epistemic work.
- The SPA uses Admin HTTP, not MCP.
- Context is a browsing scope rather than a canvas node. The visual graph contains only Concept and first-class Claim nodes; Evidence and ReflectionEvents remain inspectable metadata.
- Knowledge-map priorities are deterministic audit policy. Confidence and lifecycle affect badges/borders, never semantic node size.
- Context-map reads do not mutate the primary graph, add derived storage, or couple benchmark artifacts into production memory.
- No ORM, GraphQL, external message queue, Redux, or reranker in the first release.

## Failure rules

- A MemoryDelta is either fully committed or has no visible effect.
- Project-boundary violations fail before mutation.
- Revision mismatch returns `MEMORY_CONFLICT` with the actual revision.
- Missing or non-finite embeddings return `EMBEDDING_FAILURE` and prevent commit.
- Historical and invalidated knowledge remains queryable unless an explicit sensitive-data hard delete is performed.
- Derived indexes may be rebuilt; primary graph and ReflectionEvents may not depend on them for recovery.

## Test strategy

- domain tests for lifecycle, provenance, temporal, and project invariants;
- use-case tests using an in-memory port implementation;
- shared storage and embedding adapter contract tests;
- FalkorDB integration tests against the pinned container;
- MCP conformance tests over Streamable HTTP and stdio;
- retrieval fixtures covering Russian, English, code symbols, context, and time;
- Playwright tests for context browsing without Search, graph selection, search, explanation, history, and conflicts;
- backup/restore and event replay tests;
- import-boundary checks preventing infrastructure leakage.

## Risks and gates

1. FalkorDB must demonstrate atomic event + graph + revision updates under concurrent writers.
2. Ollama BGE-M3 must pass finite-vector, dimension, multilingual relevance, and technical-Markdown regression tests.
3. MCP SDK versions remain isolated and pinned because the protocol is evolving.
4. Model digest and embedding dimension are part of index identity; changing either requires reindexing.
