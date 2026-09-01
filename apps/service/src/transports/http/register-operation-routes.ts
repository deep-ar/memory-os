import type { FastifyInstance } from "fastify";
import type { IntegrityReport } from "../../modules/integrity/index.js";
import type { HardDeleteEvidenceCommand, HardDeleteEvidenceResult, HardDeleteReason } from "../../modules/sensitive-data/index.js";
import type { AdminRequestValidator } from "./types.js";

export function registerOperationRoutes(
  app: FastifyInstance,
  options: {
    readonly checkIntegrity: () => Promise<IntegrityReport>;
    readonly validateRequest: AdminRequestValidator;
    readonly metrics?: { renderPrometheus(report: IntegrityReport): string };
    readonly hardDeleteEvidence?: (command: HardDeleteEvidenceCommand) => Promise<HardDeleteEvidenceResult>;
  },
): void {
  app.get("/api/v1/integrity", async (request, reply) => {
    const validation = options.validateRequest(request.headers.host, request.headers.origin);
    if (!validation.ok) {
      reply.code(403);
      return {
        status: "failed",
        error: { code: "REQUEST_ORIGIN_REJECTED", message: validation.message },
      };
    }
    const report = await options.checkIntegrity();
    if (report.status === "degraded") reply.code(503);
    return report;
  });

  if (options.metrics !== undefined) {
    app.get("/metrics", async (request, reply) => {
      const validation = options.validateRequest(request.headers.host, request.headers.origin);
      if (!validation.ok) {
        reply.code(403);
        return validation.message;
      }
      const report = await options.checkIntegrity();
      reply.type("text/plain; version=0.0.4; charset=utf-8");
      return options.metrics!.renderPrometheus(report);
    });
  }

  if (options.hardDeleteEvidence !== undefined) {
    app.delete<{
      Params: { projectId: string; evidenceId: string };
      Body: { reason?: HardDeleteReason; actor?: string; confirmation?: string };
    }>("/api/v1/projects/:projectId/evidence/:evidenceId", async (request, reply) => {
      const validation = options.validateRequest(request.headers.host, request.headers.origin);
      if (!validation.ok) {
        reply.code(403);
        return { status: "failed", error: { code: "REQUEST_ORIGIN_REJECTED", message: validation.message } };
      }
      const { reason, actor, confirmation } = request.body ?? {};
      if (confirmation !== "DELETE_SENSITIVE_EVIDENCE" ||
          !["credential", "privacy", "legal", "other"].includes(reason ?? "") ||
          typeof actor !== "string" || actor.trim().length < 1 || actor.length > 120) {
        reply.code(400);
        return {
          status: "failed",
          error: {
            code: "INVALID_HARD_DELETE_REQUEST",
            message: "reason, actor, and confirmation='DELETE_SENSITIVE_EVIDENCE' are required.",
          },
        };
      }
      const result = await options.hardDeleteEvidence!({
        projectId: request.params.projectId,
        evidenceId: request.params.evidenceId,
        reason: reason!,
        actor: actor.trim(),
      });
      if (!result.ok) {
        reply.code(404);
        return { status: "failed", error: result };
      }
      return { status: "deleted", auditId: result.auditId, deletedAt: result.deletedAt };
    });
  }
}
