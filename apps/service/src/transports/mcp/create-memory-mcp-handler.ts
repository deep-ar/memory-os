import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { MemoryToolService } from "../../modules/memory-tools/index.js";
import { createMemoryMcpServer } from "./create-memory-mcp-server.js";

export function createMemoryMcpHandler(tools: MemoryToolService): McpHttpHandler {
  return createMcpHandler(() => createMemoryMcpServer(tools), {
    responseMode: "json",
    legacy: "stateless",
  });
}
