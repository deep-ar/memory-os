import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime/create-runtime.js";
import { createMemoryMcpHandler } from "./transports/mcp/index.js";

const config = loadConfig(process.env);
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;

try {
  runtime = await createRuntime(config);
  const app = createApp({
    readiness: runtime.readiness,
    mcp: createMemoryMcpHandler(runtime.tools),
    allowedHostnames: config.MEMORYOS_ALLOWED_HOSTS,
    registerProject: runtime.registerProject,
    tools: runtime.tools,
    knowledgeMap: runtime.knowledgeMap,
    listProjects: runtime.listProjects,
    checkIntegrity: runtime.checkIntegrity,
    metrics: runtime.metrics,
    hardDeleteEvidence: runtime.hardDeleteEvidence,
    ...(config.MEMORYOS_AUTH_TOKEN === undefined ? {} : { authToken: config.MEMORYOS_AUTH_TOKEN }),
    ...(config.MEMORYOS_WEB_ROOT === undefined ? {} : { staticRoot: config.MEMORYOS_WEB_ROOT }),
  });
  app.addHook("onClose", async () => {
    await runtime!.close();
  });
  await app.listen({ host: config.MEMORYOS_HOST, port: config.MEMORYOS_PORT });
} catch (error) {
  console.error(error);
  await runtime?.close();
  process.exitCode = 1;
}
