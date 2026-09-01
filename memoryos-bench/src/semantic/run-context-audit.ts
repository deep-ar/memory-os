import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import type { BenchmarkDataset } from "../domain/dataset.js";
import type { DatasetDescriptor } from "../domain/run-context.js";

const ContextResponseSchema = z.object({
  claims: z.array(z.object({
    id: z.string().min(1),
    statement: z.string().min(1),
  }).passthrough()),
  concepts: z.array(z.object({ id: z.string().min(1) }).passthrough()).default([]),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).passthrough();

export interface SemanticContextAuditOptions {
  readonly dataset: BenchmarkDataset;
  readonly descriptor: DatasetDescriptor;
  readonly serviceUrl: string;
  readonly authToken?: string;
  readonly tokenBudget: number;
  readonly queriesByProbeId?: ReadonlyMap<string, readonly string[]>;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

export async function runSemanticContextAudit(options: SemanticContextAuditOptions) {
  const project = options.dataset.projects[0];
  if (project === undefined || options.dataset.projects.length !== 1) {
    throw new Error("Semantic context audit requires exactly one dataset project.");
  }
  const endpoint = new URL("mcp", options.serviceUrl.endsWith("/") ? options.serviceUrl : `${options.serviceUrl}/`);
  const headers = options.authToken === undefined ? {} : { authorization: `Bearer ${options.authToken}` };
  const client = new Client({ name: "memoryos-semantic-context-audit", version: "0.1.0" });
  const startedAt = new Date().toISOString();
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }));
  try {
    const observations = [];
    for (const probe of options.dataset.probes) {
      const started = performance.now();
      const retrievalQueries = options.queriesByProbeId?.get(probe.id) ?? [probe.query.text];
      const responses = [];
      for (const retrievalQuery of retrievalQueries) {
        const result = await client.callTool({
          name: "memory.get_context",
          arguments: {
            project_id: probe.project_id,
            task_description: retrievalQuery,
            token_budget: options.tokenBudget,
          },
        });
        if (result.isError === true) {
          throw new Error(`memory.get_context failed for '${probe.id}': ${JSON.stringify(result.structuredContent).slice(0, 1_000)}`);
        }
        responses.push(ContextResponseSchema.parse(result.structuredContent));
      }
      const claimsById = new Map(responses.flatMap((response) => response.claims).map((claim) => [claim.id, claim]));
      const conceptIds = new Set(responses.flatMap((response) => response.concepts).map((concept) => concept.id));
      const expectedClaimIds = probe.gold.relevant
        .filter((entity) => entity.entity_type === "claim")
        .map((entity) => entity.entity_id);
      const expectedConceptIds = probe.gold.relevant
        .filter((entity) => entity.entity_type === "concept")
        .map((entity) => entity.entity_id);
      const retrievedClaimIds = new Set(claimsById.keys());
      const foundClaimIds = expectedClaimIds.filter((id) => retrievedClaimIds.has(id));
      const foundConceptIds = expectedConceptIds.filter((id) => conceptIds.has(id));
      observations.push({
        id: probe.id,
        question: probe.query.text,
        durationMs: performance.now() - started,
        retrievalQueries,
        tokenBudget: options.tokenBudget,
        estimatedTokens: responses.reduce((sum, response) => sum + response.estimatedTokens, 0),
        truncated: responses.some((response) => response.truncated),
        expectedClaimIds,
        foundClaimIds,
        missingClaimIds: expectedClaimIds.filter((id) => !retrievedClaimIds.has(id)),
        claimRecall: foundClaimIds.length / expectedClaimIds.length,
        expectedConceptIds,
        foundConceptIds,
        conceptRecall: expectedConceptIds.length === 0 ? null : foundConceptIds.length / expectedConceptIds.length,
        retrievedClaims: [...claimsById.values()].map((claim) => ({ id: claim.id, statement: claim.statement })),
      });
    }
    const durations = observations.map((observation) => observation.durationMs);
    return {
      schemaVersion: 1,
      benchmark: "MemoryOS semantic context audit",
      dataset: options.descriptor,
      projectId: project.id,
      startedAt,
      completedAt: new Date().toISOString(),
      tokenBudget: options.tokenBudget,
      observations,
      summary: {
        questions: observations.length,
        fullyCovered: observations.filter((observation) => observation.claimRecall === 1).length,
        meanClaimRecall: observations.reduce((sum, observation) => sum + observation.claimRecall, 0) / observations.length,
        meanDurationMs: durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
        p95DurationMs: percentile(durations, 0.95),
        truncated: observations.filter((observation) => observation.truncated).length,
      },
    };
  } finally {
    await client.close();
  }
}
