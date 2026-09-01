# Architecture review — stage 6

Date: 2026-08-30

Verdict: pass.

## Architecture summary

The React explorer owns transient presentation state and talks only to a versioned Admin HTTP API. Admin routes translate browser queries into the existing MemoryToolService and a new business-oriented ProjectCatalogStore port. FalkorDB remains hidden behind adapters, and the service composition root wires catalog, read tools, static assets, and local request validation.

## Review scores

| Category | Score | Evidence |
|---|---:|---|
| Business alignment | 2 | UI centers Claim belief, Evidence, provenance, conflicts, and history |
| Cohesion | 2 | catalog, transport, web API adapter, and presentation have separate reasons to change |
| Coupling | 2 | web imports no service, MCP, or FalkorDB implementation |
| Information hiding | 2 | `/api/v1` exposes task-oriented reads, not graph CRUD |
| Replaceability | 2 | React/Fastify/FalkorDB changes stay in their adapters/composition |
| Abstraction quality | 2 | no Redux, GraphQL, generic repository, or speculative UI framework |
| Testability | 2 | use-case, transport, static, architecture, real-adapter, and browser tests |
| Operational clarity | 1 | local guards and same-origin serving are explicit; remote auth remains stage 7 |

## Findings fixed

- High: Claim explanation initially returned retrieval-summary Evidence, which could not support the required belief inspection. `FullEvidence` now exposes the complete stored content/provenance fields through the read model and real FalkorDB test.
- High: existing-Claim conflict inspection included the Claim itself as a 100% candidate. The Admin route now filters self-reference while the agent-facing prospective conflict tool remains unchanged.
- Medium: Admin routes were initially unversioned. CLI, SPA, tests, and routes now use `/api/v1`.
- Medium: the UI/browser boundary lacked an automated import rule. Architecture tests now reject service, FalkorDB, or MCP imports from `apps/web`.

## Accepted trade-offs and remaining risks

- The explorer uses one cohesive `App.tsx` with local presentation components. It has one view-state owner and no heterogeneous business policy, so extraction is deferred until independent screens evolve.
- The current production E2E uses the registered `agent-memory` acceptance fixture. A hermetic ephemeral database/browser fixture belongs to stage 7 operational acceptance.
- Administrative lifecycle mutations remain intentionally absent until audited domain commands exist.
- Authentication, secret redaction, hard delete, scheduling, metrics, and tracing remain stage 7 scope.

## Checks

- workspace typecheck, unit tests, and production builds;
- real FalkorDB plus Ollama suite: 19 files and 57 tests passed;
- Chrome production E2E for `WHY DO WE BELIEVE THIS?` passed;
- final screenshot reviewed at desktop width; no self-conflict or runtime page errors remain.
