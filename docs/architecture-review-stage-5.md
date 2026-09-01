# Architecture review — stage 5

Date: 2026-08-30

Verdict: pass. Stage 5 satisfies its architecture boundary and can hand off to the administration SPA.

## Findings resolved during review

- The original Compose volume targeted `/data`, while FalkorDB v4.20.4 writes RDB data to `/var/lib/falkordb/data`. The live snapshot was preserved, the mount was corrected, and project revision `1` was verified after container recreation.
- The administrative project-registration route originally lacked the MCP route's DNS-rebinding protection. It now uses the official MCP Host and Origin validators and has rejection tests.
- The CLI entry point previously mixed process lifecycle, argument parsing, HTTP access, and Docker orchestration. It now delegates to explicit process, Compose operations, global configuration, and HTTP adapters.
- Restore now rejects missing/tampered manifests before stopping services, requires an explicit global-data replacement flag, and creates a safety backup first.

## Boundary assessment

| Concern | Owner | Evidence |
|---|---|---|
| CLI intent and argument mapping | `apps/cli/src/cli.ts` | injected dependencies and command tests |
| Process execution | `process-runner.ts` | stable exit/error mapping |
| Docker lifecycle and snapshots | `compose-operations.ts` | fake-runner orchestration and integrity tests |
| User-scoped connection defaults | `global-config.ts` | isolated filesystem test |
| Project semantics | service project use case | CLI only calls the administrative HTTP contract |
| Agent memory semantics | service MCP/application modules | CLI does not depend on FalkorDB or domain internals |

The backup format intentionally treats embeddings and indexes as included but derived data. Stage 7 still owns scheduled backups, graph-level integrity/replay validation, migrations, metrics, tracing, and authenticated non-local deployment.
