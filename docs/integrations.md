# Agent integration

MemoryOS exposes one stateless MCP contract at `http://127.0.0.1:7310/mcp`. Every tool requires an explicit logical `project_id`; repository and worktree paths are provenance, not project identity.

## Paseo

Paseo's canonical MCP configuration accepts HTTP servers with `type` and `url`. Use the `memoryos` entry in [`integrations/paseo/memoryos-mcp-server.json`](../integrations/paseo/memoryos-mcp-server.json) as the `mcpServers` value for an agent/session. Paseo normalizes that configuration for Codex, Claude, and other providers that support injected MCP servers.

The current upstream types are documented in [Paseo's `McpHttpServerConfig`](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/agent/agent-sdk-types.ts). A direct HTTP connection is preferred when Paseo and MemoryOS run on the same Windows host.

## Stdio-only orchestrators

Build the service once with `pnpm build`, then adapt [`integrations/generic/memoryos-stdio-server.json`](../integrations/generic/memoryos-stdio-server.json) by replacing `<MEMORYOS_INSTALL_DIR>` with the absolute installation directory. The subprocess is a thin MCP proxy: it keeps no memory and forwards every call to the Docker service named by `MEMORYOS_HTTP_URL`.

This separation means any number of orchestrators can share one MemoryOS graph without each process opening FalkorDB or loading BGE-M3.

## Memory skills

Install or link all three skills using the orchestrator's normal skill mechanism:

- [`memory-orchestrator`](../integrations/skills/memory-orchestrator/SKILL.md) routes non-trivial work between current-source inspection, memory retrieval, verification, and reflection;
- [`memory-retrieval`](../integrations/skills/memory-retrieval/SKILL.md) retrieves a bounded connected graph and tracks trust, drift, and verification;
- [`memory-reflection`](../integrations/skills/memory-reflection/SKILL.md) curates durable outcomes into one coherent `MemoryDelta`.

The orchestrator and retrieval skills never write memory. Reflection does not decide whether task-time recall is needed. Keep all three files version-controlled so policy improvements do not require a database migration.
