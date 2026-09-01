import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GlobalConfig {
  readonly serviceUrl?: string;
  readonly ollamaUrl?: string;
  readonly authToken?: string;
}

export function globalConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configRoot = environment.LOCALAPPDATA
    ?? environment.XDG_CONFIG_HOME
    ?? join(homedir(), ".config");
  return join(configRoot, "MemoryOS", "config.json");
}

export async function readGlobalConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GlobalConfig> {
  const path = globalConfigPath(environment);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as GlobalConfig;
    return {
      ...(typeof parsed.serviceUrl === "string" ? { serviceUrl: new URL(parsed.serviceUrl).href } : {}),
      ...(typeof parsed.ollamaUrl === "string" ? { ollamaUrl: new URL(parsed.ollamaUrl).href } : {}),
      ...(typeof parsed.authToken === "string" && parsed.authToken.length >= 32
        ? { authToken: parsed.authToken } : {}),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw new Error(`Cannot read MemoryOS global config '${path}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeGlobalConfig(
  config: GlobalConfig,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (config.authToken !== undefined && config.authToken.length < 32) {
    throw new Error("MemoryOS auth token must contain at least 32 characters.");
  }
  const path = globalConfigPath(environment);
  const normalized: GlobalConfig = {
    ...(config.serviceUrl === undefined ? {} : { serviceUrl: new URL(config.serviceUrl).href }),
    ...(config.ollamaUrl === undefined ? {} : { ollamaUrl: new URL(config.ollamaUrl).href }),
    ...(config.authToken === undefined ? {} : { authToken: config.authToken }),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}
