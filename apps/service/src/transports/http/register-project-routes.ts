import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ProjectRegistrationResult,
  RegisterProjectCommand,
} from "../../modules/projects/index.js";
import type { AdminRequestValidator } from "./types.js";

const RegisterProjectBodySchema = z.object({
  project_id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  description: z.string().min(1).nullable().optional(),
  repository_uri: z.string().min(1).nullable().optional(),
}).strict();

export function registerProjectRoutes(
  app: FastifyInstance,
  registerProject: (command: RegisterProjectCommand) => Promise<ProjectRegistrationResult>,
  options: {
    readonly validateRequest: AdminRequestValidator;
  },
): void {
  app.post("/api/v1/projects", async (request, reply) => {
    const validation = options.validateRequest(request.headers.host, request.headers.origin);
    if (!validation.ok) {
      reply.code(403);
      return {
        status: "failed",
        error: { code: "REQUEST_ORIGIN_REJECTED", message: validation.message },
      };
    }
    const parsed = RegisterProjectBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        status: "failed",
        error: { code: "INVALID_ARGUMENT", message: "Invalid project registration.", issues: parsed.error.issues },
      };
    }
    let result: ProjectRegistrationResult;
    try {
      result = await registerProject({
        id: parsed.data.project_id,
        name: parsed.data.name,
        ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
        ...(parsed.data.repository_uri === undefined ? {} : { repositoryUri: parsed.data.repository_uri }),
      });
    } catch (error) {
      if (error instanceof RangeError) {
        reply.code(400);
        return { status: "failed", error: { code: "INVALID_ARGUMENT", message: error.message } };
      }
      throw error;
    }
    if (!result.ok) {
      reply.code(409);
      return { status: "failed", error: result.error };
    }
    reply.code(result.created ? 201 : 200);
    return {
      status: result.created ? "created" : "exists",
      project: {
        id: result.project.id,
        name: result.project.name,
        description: result.project.description,
        repository_uri: result.project.repositoryUri,
        revision: result.project.revision,
      },
    };
  });
}
