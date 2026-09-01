import { fileURLToPath } from "node:url";
import { booleanOption, parseArguments, stringOption } from "./arguments.js";
import { createComposeOperations, type ComposeOperations } from "./compose-operations.js";
import { readGlobalConfig, writeGlobalConfig } from "./global-config.js";
import { MemoryOsHttpClient } from "./http-client.js";
import { createProcessRunner, requireSuccess, type ProcessRunner } from "./process-runner.js";

const HELP = `MemoryOS CLI

Commands:
  memoryos up
  memoryos status [--url http://127.0.0.1:7310]
  memoryos doctor [--url ...] [--ollama-url http://127.0.0.1:11434]
  memoryos configure [--url URL] [--ollama-url URL] [--auth-token TOKEN]
  memoryos project init --project-id ID [--name NAME] [--description TEXT] [--repository-uri URI]
  memoryos backup --output PATH
  memoryos restore --input PATH --confirm-replace-all-data
  memoryos mcp [--url http://127.0.0.1:7310/mcp]
`;

export interface CliDependencies {
  readonly runner: ProcessRunner;
  readonly compose: ComposeOperations;
  readonly stdout: (text: string) => void;
  readonly environment: NodeJS.ProcessEnv;
}

function print(dependencies: CliDependencies, value: unknown): void {
  dependencies.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function createDefaultDependencies(): CliDependencies {
  const runner = createProcessRunner();
  const composeFile = fileURLToPath(new URL("../../../compose.yaml", import.meta.url));
  return {
    runner,
    compose: createComposeOperations({ composeFile, runner }),
    stdout: (text) => process.stdout.write(text),
    environment: process.env,
  };
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<number> {
  const args = parseArguments(argv);
  const [command, subcommand] = args.positionals;
  if (command === undefined || command === "help" || args.options.has("help")) {
    dependencies.stdout(HELP);
    return 0;
  }

  if (command === "up") {
    await dependencies.compose.up();
    return 0;
  }

  if (command === "backup") {
    const output = stringOption(args, "output", { required: true })!;
    print(dependencies, await dependencies.compose.backup(output));
    return 0;
  }

  if (command === "restore") {
    const input = stringOption(args, "input", { required: true })!;
    if (!booleanOption(args, "confirm-replace-all-data")) {
      throw new Error("Restore replaces all MemoryOS projects. Pass --confirm-replace-all-data to continue.");
    }
    print(dependencies, await dependencies.compose.restore(input));
    return 0;
  }

  const globalConfig = await readGlobalConfig(dependencies.environment);

  if (command === "configure") {
    const serviceUrl = stringOption(args, "url", globalConfig.serviceUrl === undefined
      ? {} : { fallback: globalConfig.serviceUrl });
    const ollamaUrl = stringOption(args, "ollama-url", globalConfig.ollamaUrl === undefined
      ? {} : { fallback: globalConfig.ollamaUrl });
    const authToken = stringOption(args, "auth-token", globalConfig.authToken === undefined
      ? {} : { fallback: globalConfig.authToken });
    if (serviceUrl === undefined && ollamaUrl === undefined && authToken === undefined) {
      throw new Error("Pass --url, --ollama-url and/or --auth-token to configure MemoryOS.");
    }
    const path = await writeGlobalConfig({
      ...(serviceUrl === undefined ? {} : { serviceUrl }),
      ...(ollamaUrl === undefined ? {} : { ollamaUrl }),
      ...(authToken === undefined ? {} : { authToken }),
    }, dependencies.environment);
    print(dependencies, { status: "configured", path, serviceUrl, ollamaUrl, authTokenConfigured: authToken !== undefined });
    return 0;
  }

  const serviceUrl = stringOption(args, "url", {
    fallback: dependencies.environment.MEMORYOS_URL ?? globalConfig.serviceUrl ?? "http://127.0.0.1:7310",
  })!;
  const authToken = dependencies.environment.MEMORYOS_AUTH_TOKEN ?? globalConfig.authToken;

  if (command === "status") {
    print(dependencies, await new MemoryOsHttpClient(serviceUrl, authToken).ready());
    return 0;
  }

  if (command === "doctor") {
    const client = new MemoryOsHttpClient(serviceUrl, authToken);
    const service = await client.ready();
    const integrity = await client.integrity();
    const ollamaUrl = stringOption(args, "ollama-url", {
      fallback: dependencies.environment.OLLAMA_URL ?? globalConfig.ollamaUrl ?? "http://127.0.0.1:11434",
    })!;
    const response = await fetch(new URL("/api/tags", ollamaUrl));
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${response.statusText}`);
    const tags = await response.json() as { models?: { name?: string }[] };
    const bgeM3 = tags.models?.some((model) => model.name === "bge-m3" || model.name?.startsWith("bge-m3:")) ?? false;
    print(dependencies, { service, integrity, ollama: { status: "ready", url: ollamaUrl, bgeM3 } });
    if (!bgeM3) return 2;
    return integrity.status === "healthy" ? 0 : 3;
  }

  if (command === "project" && subcommand === "init") {
    const projectId = stringOption(args, "project-id", { required: true })!;
    const name = stringOption(args, "name", { fallback: projectId })!;
    const description = stringOption(args, "description");
    const repositoryUri = stringOption(args, "repository-uri");
    const result = await new MemoryOsHttpClient(serviceUrl, authToken).registerProject({
      projectId,
      name,
      ...(description === undefined ? {} : { description }),
      ...(repositoryUri === undefined ? {} : { repositoryUri }),
    });
    print(dependencies, result);
    return 0;
  }

  if (command === "mcp") {
    const endpoint = stringOption(args, "url", {
      fallback: dependencies.environment.MEMORYOS_HTTP_URL ?? "http://127.0.0.1:7310/mcp",
    })!;
    const entry = fileURLToPath(new URL("../../service/dist/mcp-stdio.js", import.meta.url));
    const result = await requireSuccess(dependencies.runner, process.execPath, [entry], {
      environment: { ...dependencies.environment, MEMORYOS_HTTP_URL: endpoint },
    });
    return result.code;
  }

  throw new Error(`Unknown command '${args.positionals.join(" ")}'. Run 'memoryos help'.`);
}
