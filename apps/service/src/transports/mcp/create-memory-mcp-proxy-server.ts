import type { Client } from "@modelcontextprotocol/client";
import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import {
  ApplyMemoryDeltaInputSchema,
  ClaimIdentityInputSchema,
  FindConceptsInputSchema,
  FindConflictsInputSchema,
  GetContextInputSchema,
  HistoryInputSchema,
  SearchInputSchema,
} from "./schemas.js";

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function createMemoryMcpProxyServer(client: Client): McpServer {
  const server = new McpServer(
    { name: "memoryos-stdio-proxy", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const forward = (name: string, input: unknown): Promise<CallToolResult> => client.callTool({
    name,
    arguments: jsonRecord(input),
  });
  const readOnly = { readOnlyHint: true, idempotentHint: true } as const;

  server.registerTool("memory.search", {
    description: "Hybrid MemoryOS search.", inputSchema: SearchInputSchema, annotations: readOnly,
  }, (input) => forward("memory.search", input));
  server.registerTool("memory.get_context", {
    description: "Compact task-specific memory context.", inputSchema: GetContextInputSchema, annotations: readOnly,
  }, (input) => forward("memory.get_context", input));
  server.registerTool("memory.find_concepts", {
    description: "Find MemoryOS concepts.", inputSchema: FindConceptsInputSchema, annotations: readOnly,
  }, (input) => forward("memory.find_concepts", input));
  server.registerTool("memory.get_claim", {
    description: "Get a MemoryOS claim.", inputSchema: ClaimIdentityInputSchema, annotations: readOnly,
  }, (input) => forward("memory.get_claim", input));
  server.registerTool("memory.explain_claim", {
    description: "Explain a MemoryOS claim.", inputSchema: ClaimIdentityInputSchema, annotations: readOnly,
  }, (input) => forward("memory.explain_claim", input));
  server.registerTool("memory.find_conflicts", {
    description: "Find potential claim conflicts.", inputSchema: FindConflictsInputSchema, annotations: readOnly,
  }, (input) => forward("memory.find_conflicts", input));
  server.registerTool("memory.apply_delta", {
    description: "Atomically apply a MemoryDelta.", inputSchema: ApplyMemoryDeltaInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, (input) => forward("memory.apply_delta", input));
  server.registerTool("memory.history", {
    description: "Read immutable reflection history.", inputSchema: HistoryInputSchema, annotations: readOnly,
  }, (input) => forward("memory.history", input));
  return server;
}
