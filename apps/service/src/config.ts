import { z } from "zod";

const configSchema = z.object({
  MEMORYOS_HOST: z.string().min(1).default("127.0.0.1"),
  MEMORYOS_PORT: z.coerce.number().int().min(1).max(65_535).default(7310),
  MEMORYOS_ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1,[::1],memoryos")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  FALKORDB_URL: z.string().url().default("falkor://127.0.0.1:6379"),
  MEMORYOS_GRAPH_NAME: z.string().min(1).default("memoryos"),
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default("bge-m3"),
  OLLAMA_EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(1024),
  MEMORYOS_WEB_ROOT: z.string().min(1).optional(),
  MEMORYOS_EXTERNAL_ACCESS: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  MEMORYOS_AUTH_TOKEN: z.string().min(32).optional(),
}).superRefine((config, context) => {
  if (config.MEMORYOS_EXTERNAL_ACCESS && config.MEMORYOS_AUTH_TOKEN === undefined) {
    context.addIssue({
      code: "custom",
      path: ["MEMORYOS_AUTH_TOKEN"],
      message: "MEMORYOS_EXTERNAL_ACCESS=true requires MEMORYOS_AUTH_TOKEN with at least 32 characters.",
    });
  }
});

export type ServiceConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  return configSchema.parse(environment);
}
