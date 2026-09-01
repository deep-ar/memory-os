import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { SearchContext } from "../../modules/retrieval/index.js";
import type { SearchInclude, SearchTime } from "../../modules/retrieval/index.js";
import type { MemoryToolService } from "../../modules/memory-tools/index.js";
import { parseApplyMemoryDeltaInput } from "../contracts/apply-memory-delta.js";
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

function success(value: unknown): CallToolResult {
  const structuredContent = jsonRecord(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(code: string, message: string, details?: unknown): CallToolResult {
  const structuredContent = jsonRecord({
    status: "failed",
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function contextFromWire(context: z.infer<typeof SearchInputSchema>["context"]): SearchContext | null {
  if (context === null || context === undefined) return null;
  return {
    ...(context.operating_system === undefined ? {} : { operatingSystem: context.operating_system }),
    ...(context.application === undefined ? {} : { application: context.application }),
    ...(context.runtime === undefined ? {} : { runtime: context.runtime }),
    ...(context.runtime_version === undefined ? {} : { runtimeVersion: context.runtime_version }),
    ...(context.framework === undefined ? {} : { framework: context.framework }),
    ...(context.framework_version === undefined ? {} : { frameworkVersion: context.framework_version }),
    ...(context.platform === undefined ? {} : { platform: context.platform }),
    ...(context.environment === undefined ? {} : { environment: context.environment }),
  };
}

function includeFromWire(
  include: NonNullable<z.infer<typeof SearchInputSchema>["include"]>,
): Partial<SearchInclude> {
  return {
    ...(include.active === undefined ? {} : { active: include.active }),
    ...(include.disputed === undefined ? {} : { disputed: include.disputed }),
    ...(include.historical === undefined ? {} : { historical: include.historical }),
    ...(include.superseded === undefined ? {} : { superseded: include.superseded }),
    ...(include.invalidated === undefined ? {} : { invalidated: include.invalidated }),
  };
}

function timeFromWire(time: NonNullable<z.infer<typeof SearchInputSchema>["time"]>): Partial<SearchTime> {
  return {
    ...(time.at === undefined ? {} : { at: time.at }),
    ...(time.from === undefined ? {} : { from: time.from }),
    ...(time.to === undefined ? {} : { to: time.to }),
  };
}

function guarded<TArgs>(handler: (input: TArgs) => Promise<CallToolResult>) {
  return async (input: TArgs): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      return failure(
        error instanceof RangeError ? "INVALID_ARGUMENT" : "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Unknown MemoryOS error",
      );
    }
  };
}

export function createMemoryMcpServer(tools: MemoryToolService): McpServer {
  const server = new McpServer(
    { name: "memoryos", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "memory.search",
    {
      description: "Hybrid semantic, full-text and graph search in one explicit MemoryOS project.",
      inputSchema: SearchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => success(await tools.search({
      projectId: input.project_id,
      query: input.query,
      context: contextFromWire(input.context),
      ...(input.include === undefined ? {} : { include: includeFromWire(input.include) }),
      ...(input.time === undefined ? {} : { time: timeFromWire(input.time) }),
      ...(input.max_results === undefined ? {} : { maxResults: input.max_results }),
      ...(input.graph_depth === undefined ? {} : { graphDepth: input.graph_depth }),
    }))),
  );

  server.registerTool(
    "memory.get_context",
    {
      description: "Return a compact, task-specific and token-bounded memory subgraph.",
      inputSchema: GetContextInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => success(await tools.getContext({
      projectId: input.project_id,
      taskDescription: input.task_description,
      currentContext: contextFromWire(input.current_context),
      ...(input.token_budget === undefined ? {} : { tokenBudget: input.token_budget }),
    }))),
  );

  server.registerTool(
    "memory.find_concepts",
    {
      description: "Find concepts by canonical name, aliases, full text and semantic similarity.",
      inputSchema: FindConceptsInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => success(await tools.findConcepts({
      projectId: input.project_id,
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }))),
  );

  server.registerTool(
    "memory.get_claim",
    {
      description: "Get one claim by its stable id in an explicit project.",
      inputSchema: ClaimIdentityInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => {
      const claim = await tools.getClaim({ projectId: input.project_id, claimId: input.claim_id });
      return claim === null
        ? failure("CLAIM_NOT_FOUND", `Claim '${input.claim_id}' does not exist in project '${input.project_id}'.`)
        : success({ claim });
    }),
  );

  server.registerTool(
    "memory.explain_claim",
    {
      description: "Explain a claim with epistemic state, context, evidence, relations and provenance.",
      inputSchema: ClaimIdentityInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => {
      const explanation = await tools.explainClaim({
        projectId: input.project_id,
        claimId: input.claim_id,
      });
      return explanation === null
        ? failure("CLAIM_NOT_FOUND", `Claim '${input.claim_id}' does not exist in project '${input.project_id}'.`)
        : success(explanation);
    }),
  );

  server.registerTool(
    "memory.find_conflicts",
    {
      description: "Return potential conflict candidates without mutating or resolving them.",
      inputSchema: FindConflictsInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => success(await tools.findConflicts({
      projectId: input.project_id,
      subjectId: input.claim.subject_id,
      predicate: input.claim.predicate,
      objectId: input.claim.object_id ?? null,
      statement: input.claim.statement,
      contextIds: input.claim.context_ids ?? [],
      validFrom: input.claim.valid_from ?? null,
      validTo: input.claim.valid_to ?? null,
    }))),
  );

  server.registerTool(
    "memory.apply_delta",
    {
      description: "Validate and atomically append one explicit MemoryDelta and its derived search index.",
      inputSchema: ApplyMemoryDeltaInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    guarded(async (input) => {
      const result = await tools.applyDelta(parseApplyMemoryDeltaInput(input));
      return result.ok ? success(result) : failure(result.error.code, result.error.message, result.error);
    }),
  );

  server.registerTool(
    "memory.history",
    {
      description: "Read chronological immutable ReflectionEvents for a project or entity.",
      inputSchema: HistoryInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guarded(async (input) => success(await tools.history({
      projectId: input.project_id,
      ...(input.entity_type === undefined ? {} : { entityType: input.entity_type }),
      ...(input.entity_id === undefined ? {} : { entityId: input.entity_id }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }))),
  );

  return server;
}
