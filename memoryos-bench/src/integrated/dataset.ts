import { z } from "zod";

export const ExperimentalModeSchema = z.enum([
  "no_memory",
  "oracle_memory",
  "oracle_writes",
  "full_memory_os",
  "flat_rag",
]);

export const EXPERIMENTAL_MODES = ExperimentalModeSchema.options;
const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const RelativePathSchema = z.string().min(1).refine(
  (value) => !value.includes("\\") && !value.startsWith("/") && !value.split("/").includes(".."),
  "File paths must be normalized relative paths without '..'.",
);

export const MemoryItemSchema = z.object({
  id: IdSchema,
  text: z.string().min(1),
  source_project_id: IdSchema,
  kind: z.enum(["claim", "evidence", "context", "summary", "chunk"]),
  stale: z.boolean().default(false),
}).strict();

const ScenarioSchema = z.object({
  id: IdSchema,
  project_id: IdSchema,
  family: IdSchema,
  episode_index: z.number().int().nonnegative(),
  task: z.string().min(1),
  decision_options: z.array(IdSchema).min(2),
  repository: z.object({
    files: z.record(RelativePathSchema, z.string()),
    allowed_change_paths: z.array(RelativePathSchema).min(1),
  }).strict(),
  memory: z.object({
    oracle_memory: z.array(MemoryItemSchema),
    oracle_writes: z.array(MemoryItemSchema),
    full_memory_os: z.array(MemoryItemSchema),
    flat_rag: z.array(MemoryItemSchema),
  }).strict(),
  validator: z.object({
    expected_decision: z.string().min(1),
    expected_files: z.record(RelativePathSchema, z.string()),
    known_failure_ids: z.array(IdSchema).default([]),
    positive_transfer_memory_ids: z.array(IdSchema).default([]),
    stale_memory_ids: z.array(IdSchema).default([]),
  }).strict(),
}).strict();

export const IntegratedDatasetSchema = z.object({
  schema_version: z.literal(1),
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  profile: z.literal("integrated-controlled-v0.1"),
  prompt_version: z.string().min(1),
  toolset_version: z.string().min(1),
  response_contract_version: z.string().min(1),
  repetitions: z.number().int().min(3).default(3),
  scenarios: z.array(ScenarioSchema).min(1),
}).strict().superRefine((dataset, context) => {
  const scenarioIds = new Set<string>();
  for (const [index, scenario] of dataset.scenarios.entries()) {
    if (scenarioIds.has(scenario.id)) {
      context.addIssue({ code: "custom", path: ["scenarios", index, "id"], message: `Duplicate scenario '${scenario.id}'.` });
    }
    scenarioIds.add(scenario.id);
    const allowed = new Set(scenario.repository.allowed_change_paths);
    if (!scenario.decision_options.includes(scenario.validator.expected_decision)) {
      context.addIssue({ code: "custom", path: ["scenarios", index, "decision_options"], message: "Expected decision must be one of decision_options." });
    }
    for (const expectedPath of Object.keys(scenario.validator.expected_files)) {
      if (!allowed.has(expectedPath)) {
        context.addIssue({ code: "custom", path: ["scenarios", index, "validator", "expected_files"], message: `Expected file '${expectedPath}' is not an allowed change path.` });
      }
    }
    const allMemory = Object.values(scenario.memory).flat();
    const memoryIds = new Set<string>();
    for (const item of allMemory) memoryIds.add(item.id);
    for (const id of scenario.validator.positive_transfer_memory_ids) {
      if (!memoryIds.has(id)) context.addIssue({ code: "custom", path: ["scenarios", index, "validator"], message: `Unknown positive-transfer memory '${id}'.` });
    }
    for (const id of scenario.validator.stale_memory_ids) {
      if (!memoryIds.has(id)) context.addIssue({ code: "custom", path: ["scenarios", index, "validator"], message: `Unknown stale memory '${id}'.` });
    }
  }
});

export type ExperimentalMode = z.infer<typeof ExperimentalModeSchema>;
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
export type IntegratedDataset = z.infer<typeof IntegratedDatasetSchema>;
export type IntegratedScenario = IntegratedDataset["scenarios"][number];

export function parseIntegratedDataset(input: unknown): IntegratedDataset {
  return IntegratedDatasetSchema.parse(input);
}
