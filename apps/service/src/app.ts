import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  type McpHttpHandler,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import type { EmbeddingModelIdentity } from "./modules/retrieval/index.js";
import type { MemoryToolService } from "./modules/memory-tools/index.js";
import type { ProjectOverview } from "./modules/projects/index.js";
import type { IntegrityReport } from "./modules/integrity/index.js";
import type { HardDeleteEvidenceCommand, HardDeleteEvidenceResult } from "./modules/sensitive-data/index.js";
import type { ProjectRegistrationResult, RegisterProjectCommand } from "./modules/projects/index.js";
import { registerProjectRoutes } from "./transports/http/register-project-routes.js";
import { registerMemoryReadRoutes } from "./transports/http/register-memory-read-routes.js";
import { registerStaticUi } from "./transports/http/register-static-ui.js";
import { registerOperationRoutes } from "./transports/http/register-operation-routes.js";

export interface AppReadiness {
  readonly storage: "ready";
  readonly embedding: EmbeddingModelIdentity;
  readonly embeddingIndex:
    | { readonly status: "empty" }
    | { readonly status: "ready"; readonly identity: EmbeddingModelIdentity }
    | { readonly status: "reindex_required"; readonly identity: EmbeddingModelIdentity };
}

export function createApp(options: {
  readonly readiness: AppReadiness;
  readonly mcp?: McpHttpHandler;
  readonly allowedHostnames?: readonly string[];
  readonly registerProject?: (command: RegisterProjectCommand) => Promise<ProjectRegistrationResult>;
  readonly tools?: MemoryToolService;
  readonly listProjects?: () => Promise<readonly ProjectOverview[]>;
  readonly staticRoot?: string;
  readonly checkIntegrity?: () => Promise<IntegrityReport>;
  readonly metrics?: { renderPrometheus(report: IntegrityReport): string };
  readonly authToken?: string;
  readonly hardDeleteEvidence?: (command: HardDeleteEvidenceCommand) => Promise<HardDeleteEvidenceResult>;
}): FastifyInstance {
  const app = Fastify({ logger: true });
  const allowedHostnames = [...(options.allowedHostnames ?? ["localhost", "127.0.0.1", "[::1]"])];

  if (options.authToken !== undefined) {
    const expected = Buffer.from(`Bearer ${options.authToken}`);
    app.addHook("onRequest", async (request, reply) => {
      const protectedPath = request.url === "/mcp" || request.url === "/metrics"
        || request.url.startsWith("/api/v1/");
      if (!protectedPath) return;
      const supplied = Buffer.from(request.headers.authorization ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        reply.header("www-authenticate", "Bearer realm=\"MemoryOS\"");
        await reply.code(401).send({
          status: "failed",
          error: { code: "AUTHENTICATION_REQUIRED", message: "A valid MemoryOS Bearer token is required." },
        });
      }
    });
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "memoryos",
  }));

  app.get("/ready", async (_request, reply) => {
    const ready = options.readiness.embeddingIndex.status !== "reindex_required";
    if (!ready) {
      reply.code(503);
    }
    return {
      status: ready ? "ready" : "not_ready",
      storage: options.readiness.storage,
      embedding: options.readiness.embedding,
      embeddingIndex: options.readiness.embeddingIndex,
    };
  });

  if (options.registerProject !== undefined) {
    registerProjectRoutes(app, options.registerProject, {
      validateRequest: (host, origin) => {
        const hostResult = validateHostHeader(host, allowedHostnames);
        if (!hostResult.ok) return hostResult;
        return validateOriginHeader(origin, allowedHostnames);
      },
    });
  }

  if (options.tools !== undefined && options.listProjects !== undefined) {
    registerMemoryReadRoutes(app, {
      tools: options.tools,
      listProjects: options.listProjects,
      validateRequest: (host, origin) => {
        const hostResult = validateHostHeader(host, allowedHostnames);
        if (!hostResult.ok) return hostResult;
        return validateOriginHeader(origin, allowedHostnames);
      },
    });
  }

  if (options.checkIntegrity !== undefined) {
    registerOperationRoutes(app, {
      checkIntegrity: options.checkIntegrity,
      ...(options.hardDeleteEvidence === undefined ? {} : { hardDeleteEvidence: options.hardDeleteEvidence }),
      ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
      validateRequest: (host, origin) => {
        const hostResult = validateHostHeader(host, allowedHostnames);
        if (!hostResult.ok) return hostResult;
        return validateOriginHeader(origin, allowedHostnames);
      },
    });
  }

  if (options.mcp !== undefined) {
    const validateHost = hostHeaderValidation(allowedHostnames);
    const validateOrigin = originValidation(allowedHostnames);
    const nodeHandler = toNodeHandler(options.mcp, {
      onerror: (error) => app.log.error(error, "MCP Node adapter failed"),
    });

    app.all("/mcp", async (request, reply) => {
      reply.hijack();
      if (!validateHost(request.raw, reply.raw) || !validateOrigin(request.raw, reply.raw)) {
        return;
      }
      await nodeHandler(
        request.raw as Parameters<typeof nodeHandler>[0],
        reply.raw,
        request.body,
      );
    });
    app.addHook("onClose", async () => options.mcp!.close());
  }

  if (options.staticRoot !== undefined) {
    registerStaticUi(app, options.staticRoot);
  }

  return app;
}
