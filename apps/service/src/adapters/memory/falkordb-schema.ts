import {
  ConstraintType,
  EntityType,
  type Graph,
} from "falkordb";

export const CURRENT_SCHEMA_VERSION = 1;

interface SchemaVersionRow { readonly version: number }

const UNIQUE_IDENTITIES = [
  { label: "Project", properties: ["id"] },
  { label: "Concept", properties: ["projectId", "id"] },
  { label: "Claim", properties: ["projectId", "id"] },
  { label: "Evidence", properties: ["projectId", "id"] },
  { label: "Context", properties: ["projectId", "id"] },
  { label: "ReflectionEvent", properties: ["projectId", "id"] },
  { label: "HardDeleteAudit", properties: ["projectId", "id"] },
] as const;

const RANGE_INDEXES = [
  { label: "Concept", properties: ["canonicalName", "conceptType"] },
  {
    label: "Claim",
    properties: [
      "predicate",
      "epistemicBasis",
      "confidenceLevel",
      "lifecycleStatus",
      "validFrom",
      "validTo",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    label: "Evidence",
    properties: ["type", "sourceUri", "commit", "file", "observedAt", "contentHash"],
  },
  {
    label: "ReflectionEvent",
    properties: ["agentId", "sessionId", "taskId", "branch", "commit", "trigger", "createdAt"],
  },
] as const;

const SEARCH_INDEXES = [
  { label: "Concept", fullText: ["canonicalName", "aliases", "description", "conceptType"] },
  { label: "Claim", fullText: ["predicate", "statement", "embeddingText"] },
  { label: "Evidence", fullText: ["summary", "content", "quote", "file", "symbol"] },
] as const;

function isAlreadyPresent(error: unknown): boolean {
  return (
    error instanceof Error &&
    /already exists|equivalent constraint|already indexed/i.test(error.message)
  );
}

async function ensureExactMatchIndexes(
  graph: Graph,
  label: string,
  properties: readonly string[],
): Promise<void> {
  for (const property of properties) {
    try {
      await graph.createNodeRangeIndex(label, property);
    } catch (error) {
      if (!isAlreadyPresent(error)) {
        throw error;
      }
    }
  }
}

async function ensureUniqueConstraint(
  graph: Graph,
  label: string,
  properties: readonly string[],
): Promise<void> {
  try {
    await graph.constraintCreate(
      ConstraintType.UNIQUE,
      EntityType.NODE,
      label,
      ...properties,
    );
  } catch (error) {
    if (!isAlreadyPresent(error)) {
      throw error;
    }
  }
}

async function ensureFullTextIndex(
  graph: Graph,
  label: string,
  properties: readonly string[],
): Promise<void> {
  try {
    await graph.createNodeFulltextIndex(label, ...properties);
  } catch (error) {
    if (!isAlreadyPresent(error)) {
      throw error;
    }
  }
}

async function ensureVectorIndex(
  graph: Graph,
  label: string,
  dimension: number,
): Promise<void> {
  try {
    await graph.createNodeVectorIndex(label, dimension, "cosine", "embedding");
  } catch (error) {
    if (!isAlreadyPresent(error)) {
      throw error;
    }
  }
}

export async function bootstrapFalkorDbSchema(
  graph: Graph,
  options: { readonly embeddingDimension: number },
): Promise<void> {
  const schema = await graph.query<SchemaVersionRow>(
    `MERGE (schema:MemoryOsSchema {id: 'primary'})
     ON CREATE SET schema.version = 0, schema.createdAt = $now
     RETURN schema.version AS version`,
    {
      params: {
        now: new Date().toISOString(),
      },
    },
  );
  let version = schema.data?.[0]?.version;
  if (version === undefined || !Number.isInteger(version) || version < 0) {
    throw new Error("MemoryOS schema metadata is missing or invalid.");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `MemoryOS data schema ${version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}.`,
    );
  }
  if (version === 0) {
    for (const label of ["Project", "Concept", "Claim", "Evidence", "Context", "ReflectionEvent", "HardDeleteAudit"] as const) {
      await graph.query(
        `MATCH (entity:${label}) WHERE entity.schemaVersion IS NULL SET entity.schemaVersion = 1`,
      );
    }
    await graph.query(
      `MATCH (schema:MemoryOsSchema {id: 'primary', version: 0})
       SET schema.version = 1, schema.migratedAt = $now`,
      { params: { now: new Date().toISOString() } },
    );
    version = 1;
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`No migration path from schema ${version} to ${CURRENT_SCHEMA_VERSION}.`);
  }

  for (const identity of UNIQUE_IDENTITIES) {
    await ensureExactMatchIndexes(graph, identity.label, identity.properties);
    await ensureUniqueConstraint(graph, identity.label, identity.properties);
  }

  for (const index of RANGE_INDEXES) {
    await ensureExactMatchIndexes(graph, index.label, index.properties);
  }

  for (const index of SEARCH_INDEXES) {
    await ensureFullTextIndex(graph, index.label, index.fullText);
    await ensureVectorIndex(graph, index.label, options.embeddingDimension);
  }
}
