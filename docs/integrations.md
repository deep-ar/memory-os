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

## Codex compaction checkpoint

Codex can trigger selective memory reflection immediately after it compacts a session. The integration deliberately uses `SessionStart` with `source=compact`, rather than `PreCompact`: the post-compaction event can add developer context to the immediate continuation, while `PreCompact` cannot ask the current agent to perform semantic work.

1. Copy [`integrations/codex/memoryos-compaction.mjs`](../integrations/codex/memoryos-compaction.mjs) to a stable user-level location such as `~/.codex/hooks/`.
2. Merge [`integrations/codex/hooks.example.json`](../integrations/codex/hooks.example.json) into `~/.codex/hooks.json` and replace the Windows user placeholder when applicable.
3. Add `.memoryos/project.json` to each participating project using [`integrations/codex/project.example.json`](../integrations/codex/project.example.json) as the template.
4. Review and trust the hook through Codex `/hooks`. Codex keys trust to the hook definition, so changing it requires another review.

The project manifest is an explicit mapping, not path-based inference. A session may instead receive `MEMORYOS_PROJECT_ID` from its orchestrator; that explicit environment value takes precedence. If neither exists, the global hook is silent and the project remains opted out.

The hook does not call a model or write MemoryOS itself. It instructs the current agent to invoke `memory-reflection`, whose assessment may intentionally produce no write. Local edits are normally skipped; cross-module behavior and durable decisions are candidates; unfinished research stays tentative; user approval proves a selected direction but not technical correctness; code changes and behavioral validation remain separate Evidence.

Run the deterministic hook tests with:

```powershell
node --test integrations/codex/memoryos-compaction.test.mjs
```
