import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MemoryToolService } from "../../modules/memory-tools/index.js";
import type { ProjectOverview } from "../../modules/projects/index.js";
import type { AdminRequestValidator } from "./types.js";

const ProjectParams = z.object({ projectId: z.string().min(1).max(128) }).strict();
const ClaimParams = ProjectParams.extend({ claimId: z.string().min(1).max(200) }).strict();
const SearchQuery = z.object({
  q: z.string().trim().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
const HistoryQuery = z.object({
  entity_type: z.string().min(1).max(100).optional(),
  entity_id: z.string().min(1).max(200).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict().refine(
  (query) => (query.entity_type === undefined) === (query.entity_id === undefined),
  { message: "entity_type and entity_id must be provided together" },
);

function rejectInvalid(reply: FastifyReply, issues: unknown) {
  reply.code(400);
  return { status: "failed", error: { code: "INVALID_ARGUMENT", issues } };
}

function guard(
  request: FastifyRequest,
  reply: FastifyReply,
  validateRequest: AdminRequestValidator,
): object | null {
  const validation = validateRequest(request.headers.host, request.headers.origin);
  if (validation.ok) return null;
  reply.code(403);
  return {
    status: "failed",
    error: { code: "REQUEST_ORIGIN_REJECTED", message: validation.message },
  };
}

export function registerMemoryReadRoutes(
  app: FastifyInstance,
  options: {
    readonly tools: MemoryToolService;
    readonly listProjects: () => Promise<readonly ProjectOverview[]>;
    readonly validateRequest: AdminRequestValidator;
  },
): void {
  app.get("/api/v1/projects", async (request, reply) => {
    const rejected = guard(request, reply, options.validateRequest);
    if (rejected !== null) return rejected;
    return { projects: await options.listProjects() };
  });

  app.get("/api/v1/projects/:projectId/search", async (request, reply) => {
    const rejected = guard(request, reply, options.validateRequest);
    if (rejected !== null) return rejected;
    const params = ProjectParams.safeParse(request.params);
    const query = SearchQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return rejectInvalid(reply, [...(params.success ? [] : params.error.issues), ...(query.success ? [] : query.error.issues)]);
    }
    try {
      return await options.tools.search({
        projectId: params.data.projectId,
        query: query.data.q,
        maxResults: query.data.limit ?? 25,
        graphDepth: 1,
      });
    } catch (error) {
      if (error instanceof RangeError) return rejectInvalid(reply, [{ message: error.message }]);
      throw error;
    }
  });

  app.get("/api/v1/projects/:projectId/claims/:claimId/explanation", async (request, reply) => {
    const rejected = guard(request, reply, options.validateRequest);
    if (rejected !== null) return rejected;
    const params = ClaimParams.safeParse(request.params);
    if (!params.success) return rejectInvalid(reply, params.error.issues);
    const explanation = await options.tools.explainClaim({
      projectId: params.data.projectId,
      claimId: params.data.claimId,
    });
    if (explanation === null) {
      reply.code(404);
      return { status: "failed", error: { code: "CLAIM_NOT_FOUND" } };
    }
    return explanation;
  });

  app.get("/api/v1/projects/:projectId/claims/:claimId/conflicts", async (request, reply) => {
    const rejected = guard(request, reply, options.validateRequest);
    if (rejected !== null) return rejected;
    const params = ClaimParams.safeParse(request.params);
    if (!params.success) return rejectInvalid(reply, params.error.issues);
    const claim = await options.tools.getClaim({
      projectId: params.data.projectId,
      claimId: params.data.claimId,
    });
    if (claim === null) {
      reply.code(404);
      return { status: "failed", error: { code: "CLAIM_NOT_FOUND" } };
    }
    const result = await options.tools.findConflicts({
      projectId: params.data.projectId,
      subjectId: claim.subjectId,
      predicate: claim.predicate,
      objectId: claim.objectId,
      statement: claim.statement,
      contextIds: claim.contextIds,
      validFrom: claim.validFrom,
      validTo: claim.validTo,
    });
    return {
      potentialConflicts: result.potentialConflicts.filter((candidate) => candidate.claimId !== claim.id),
    };
  });

  app.get("/api/v1/projects/:projectId/history", async (request, reply) => {
    const rejected = guard(request, reply, options.validateRequest);
    if (rejected !== null) return rejected;
    const params = ProjectParams.safeParse(request.params);
    const query = HistoryQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return rejectInvalid(reply, [...(params.success ? [] : params.error.issues), ...(query.success ? [] : query.error.issues)]);
    }
    return options.tools.history({
      projectId: params.data.projectId,
      ...(query.data.entity_type === undefined ? {} : {
        entityType: query.data.entity_type,
        entityId: query.data.entity_id!,
      }),
      ...(query.data.from === undefined ? {} : { from: query.data.from }),
      ...(query.data.to === undefined ? {} : { to: query.data.to }),
      ...(query.data.limit === undefined ? {} : { limit: query.data.limit }),
    });
  });
}
