import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { createMemoryMcpProxyServer } from "./transports/mcp/create-memory-mcp-proxy-server.js";

const endpoint = z.string().url().parse(
  process.env.MEMORYOS_HTTP_URL ?? "http://127.0.0.1:7310/mcp",
);
const client = new Client({ name: "memoryos-stdio-proxy", version: "0.1.0" });
const authToken = process.env.MEMORYOS_AUTH_TOKEN;

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    ...(authToken === undefined ? {} : {
      requestInit: { headers: { authorization: `Bearer ${authToken}` } },
    }),
  }));
  const handle = serveStdio(() => createMemoryMcpProxyServer(client), {
    onerror: (error) => console.error(error),
  });

  const close = async () => {
    await handle.close();
    await client.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
} catch (error) {
  console.error(`Cannot connect stdio proxy to MemoryOS at ${endpoint}`, error);
  await client.close();
  process.exitCode = 1;
}
