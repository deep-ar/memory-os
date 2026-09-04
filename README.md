# MemoryOS

MemoryOS is a local-first, multi-project knowledge graph for coding agents. It preserves durable facts, relations, decisions, problems, constraints, evidence, context, and operational know-how across sessions, branches, worktrees, agents, and orchestrators.

The system stores semantic knowledge rather than transcripts or session summaries. Agents own epistemic judgment and reflection policy; the service provides deterministic validation, atomic persistence, retrieval, concurrency control, provenance, and audit.

## What is included

- a TypeScript and Node.js modular service;
- atomic temporal graph storage in FalkorDB;
- replaceable BGE-M3 embeddings through native Ollama;
- semantic, full-text, graph, temporal, contextual, and epistemic retrieval with deterministic RRF fusion;
- eight canonical MCP tools over Streamable HTTP and a thin stdio proxy;
- an operational CLI for lifecycle, project registration, diagnostics, backup, and restore;
- a React SPA for context-first graph browsing plus inspection of Claims, Evidence, conflicts, provenance, and history;
- project-invariant skills for memory orchestration, retrieval, verification, and reflection;
- a detachable benchmark with controlled, Curator, Integrated, and real-session evaluation tracks.

## Architecture

One global MemoryOS installation serves multiple projects. Every memory operation requires an explicit stable `project_id`; a repository path or worktree is provenance, not project identity.

```text
coding agents / orchestrators
          │ MCP HTTP or stdio
          ▼
    MemoryOS service ─────► native Ollama / BGE-M3
          │
          ▼
       FalkorDB
```

MemoryOS and FalkorDB run through Docker Compose. Ollama runs natively by default so Windows can use the host GPU without another Docker runtime or model copy. The React application is compiled into and served by the MemoryOS service; no separate web container is required.

See [architecture](docs/architecture.md), [implementation status](docs/implementation-plan.md), and [agent integration](docs/integrations.md) for the detailed contracts and design boundaries.

## Prerequisites

- Docker Desktop with Docker Compose;
- Node.js 24;
- pnpm 10;
- Ollama with the `bge-m3` model.

Install Ollama on Windows PowerShell and download the embedding model:

```powershell
irm https://ollama.com/install.ps1 | iex
ollama pull bge-m3
```

## Quick start

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm memoryos up
pnpm memoryos status
pnpm memoryos doctor
```

After startup:

- MCP: `http://127.0.0.1:7310/mcp`;
- Explorer: `http://127.0.0.1:7310/`;
- integrity: `http://127.0.0.1:7310/api/v1/integrity`;
- metrics: `http://127.0.0.1:7310/metrics`.

The normal topology binds MemoryOS only to `127.0.0.1`. FalkorDB is not published to the host, and the `memoryos-data` volume survives ordinary container stop and recreation.

The Explorer opens in **Context map** mode. Select a logical project and a Context to inspect its connected Concepts and first-class Claims without entering a search query. `SUBJECT`, `OBJECT`, `SUPPORTS`, `CONTRADICTS`, `SUPERSEDES`, `REFINES`, and `DERIVED_FROM` retain their direction on the canvas. Evidence and ReflectionEvent provenance remain in the details panel. Optional toggles expose one-hop boundary Claims, unscoped Claims, and historical knowledge; **Search** remains available as a separate retrieval workflow.

Stop the services without deleting persistent memory:

```powershell
docker compose stop
```

Do not use `docker compose down -v` unless permanent removal of the global MemoryOS database is intentional.

## Connect a project or orchestrator

Register each logical project once. Invoke the global installation from any repository without copying MemoryOS Compose files into it:

```powershell
pnpm --dir <MEMORYOS_INSTALL_DIR> memoryos project init `
  --project-id my-stable-project-id `
  --name "My project" `
  --repository-uri "file:///D:/Projects/my-project"
```

Optional connection defaults are stored outside project Git data:

```powershell
pnpm --dir <MEMORYOS_INSTALL_DIR> memoryos configure `
  --url http://127.0.0.1:7310 `
  --ollama-url http://127.0.0.1:11434
```

On Windows the CLI writes `%LOCALAPPDATA%\MemoryOS\config.json`; on other platforms it uses `XDG_CONFIG_HOME` or `~/.config`.

Paseo can use [`integrations/paseo/memoryos-mcp-server.json`](integrations/paseo/memoryos-mcp-server.json). Stdio-only orchestrators can adapt [`integrations/generic/memoryos-stdio-server.json`](integrations/generic/memoryos-stdio-server.json); the subprocess is stateless and forwards requests to the shared HTTP service.

Install or link all three MemoryOS skills through the orchestrator's normal skill mechanism:

- [`memory-orchestrator`](integrations/skills/memory-orchestrator/SKILL.md) decides when project work needs retrieval, current-source verification, or reflection;
- [`memory-retrieval`](integrations/skills/memory-retrieval/SKILL.md) performs bounded iterative recall and tracks trust, freshness, and drift;
- [`memory-reflection`](integrations/skills/memory-reflection/SKILL.md) admits durable knowledge and writes one coherent atomic `MemoryDelta`.

The skills are policy, not database migrations. Keep them version-controlled and deploy policy updates through the orchestrator.

## Backup and restore

Prefer an output path outside the repository:

```powershell
pnpm memoryos backup --output D:\Backups\memoryos.rdb
pnpm memoryos restore --input D:\Backups\memoryos.rdb --confirm-replace-all-data
```

A backup contains the global FalkorDB database and a sibling SHA-256 manifest. Restore validates both files, creates a pre-restore safety copy, and requires an explicit replacement flag. It restores all logical projects, not a single project.

The Compose backup sidecar also produces checksummed daily snapshots under `backups/automatic`. Backup files and manifests are intentionally excluded from Git.

## Security and data handling

- Local deployment is loopback-only by default.
- Non-local access requires `MEMORYOS_EXTERNAL_ACCESS=true` and a `MEMORYOS_AUTH_TOKEN` of at least 32 characters.
- Put tokens and local overrides in the process environment or an ignored `.env` file; never commit them.
- Evidence payloads pass domain-level secret rejection.
- Sensitive Evidence deletion requires the audited Admin HTTP operation and its exact confirmation phrase.
- Logs, metrics, and `apply_delta` traces are designed not to emit memory content.

The repository `.gitignore` excludes dependencies, compiled output, local environment files, private-key formats, database snapshots, backups, generated reports, and real-project benchmark inputs.

## Development

Common checks:

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @memoryos/web test:e2e
```

Run real FalkorDB and Ollama integration tests against localhost-only endpoints:

```powershell
docker compose -f compose.yaml -f compose.integration.yaml up -d falkordb
$env:FALKORDB_INTEGRATION_URL = 'falkor://127.0.0.1:6380'
$env:OLLAMA_INTEGRATION_URL = 'http://127.0.0.1:11434'
$env:OLLAMA_INTEGRATION_MODEL = 'bge-m3'
pnpm --filter @memoryos/service test:integration
```

The integration suite intentionally runs serially. Concurrent vector-index creation across independent test graphs can crash the pinned FalkorDB module; production startup has one schema bootstrap owner and does not use that test-only concurrency pattern.

## Benchmark

`memoryos-bench` is detached from production MemoryOS and talks to it only through public contracts. Its isolated Compose stand stores FalkorDB data in `tmpfs`, so benchmark state cannot mix with the production volume:

```powershell
pnpm --filter @memoryos/bench typecheck
pnpm --filter @memoryos/bench test
pnpm --filter @memoryos/bench build
pnpm --filter @memoryos/bench stand:up
# run the selected benchmark command
pnpm --filter @memoryos/bench stand:down
```

Generated benchmark artifacts and real-project-derived inputs remain local and are excluded from Git. Synthetic datasets, schemas, evaluator calibrations, and benchmark source code are version-controlled. External-agent runs may transmit their request payload to the configured provider and therefore require explicit authorization.

See [MemoryOS-Bench](memoryos-bench/README.md) for commands, evidence labels, and the distinction between replay calibration and live-agent measurements.

## Repository layout

```text
apps/service       MemoryOS application, adapters, HTTP and MCP transports
apps/cli           lifecycle, diagnostics, project, backup and restore CLI
apps/web           React administration SPA
integrations       Paseo, generic stdio, and MemoryOS skills
memoryos-bench     detachable benchmark and synthetic evaluation data
docs               architecture, implementation, review, and operations notes
ops                operational helper scripts
```

MemoryOS is licensed under the [MIT License](LICENSE).
