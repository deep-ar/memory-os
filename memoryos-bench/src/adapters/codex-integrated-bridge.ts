import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { z } from "zod";
import { IntegratedAgentOutputSchema, type IntegratedAgentRequest } from "../integrated/agent.js";

const ModelOutputSchema = IntegratedAgentOutputSchema.omit({ cost: true });

interface Options {
  readonly codexJs: string;
  readonly model?: string;
  readonly reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  readonly timeoutMs: number;
}

interface Usage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedTokens: number | null;
}

function parseOptions(args: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--")) throw new Error("Invalid Codex bridge arguments.");
    values.set(name, value);
  }
  const appData = process.env.APPDATA;
  const codexJs = values.get("--codex-js") ?? process.env.MEMORYOS_BENCH_CODEX_JS
    ?? (appData === undefined ? undefined : join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  if (codexJs === undefined) throw new Error("Codex JS entrypoint was not supplied and APPDATA is unavailable.");
  const reasoning = values.get("--reasoning-effort");
  if (reasoning !== undefined && !["low", "medium", "high", "xhigh"].includes(reasoning)) {
    throw new Error("--reasoning-effort must be low, medium, high or xhigh.");
  }
  const timeoutText = values.get("--timeout-ms");
  const timeoutMs = timeoutText === undefined ? 240_000 : Number(timeoutText);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer.");
  const reasoningEffort = reasoning as Exclude<Options["reasoningEffort"], undefined> | undefined;
  return {
    codexJs: resolve(codexJs),
    ...(values.get("--model") === undefined ? {} : { model: values.get("--model") as string }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    timeoutMs,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numeric(record: Record<string, unknown> | null, ...keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function parseCodexEvents(stdout: string): { readonly finalText: string; readonly usage: Usage } {
  let finalText: string | null = null;
  let usage: Usage = { inputTokens: null, outputTokens: null, cachedTokens: null };
  for (const line of stdout.split(/\r?\n/u).filter((item) => item.trim().length > 0)) {
    const event = asRecord(JSON.parse(line));
    const item = asRecord(event?.item);
    if (event?.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      finalText = item.text;
    }
    if (event?.type === "turn.completed") {
      const rawUsage = asRecord(event.usage);
      usage = {
        inputTokens: numeric(rawUsage, "input_tokens", "inputTokens"),
        outputTokens: numeric(rawUsage, "output_tokens", "outputTokens"),
        cachedTokens: numeric(rawUsage, "cached_input_tokens", "cached_tokens", "cachedTokens"),
      };
    }
  }
  if (finalText === null) throw new Error("Codex JSONL did not contain a completed agent message.");
  return { finalText, usage };
}

function promptFor(request: IntegratedAgentRequest): string {
  return [
    "You are a stateless software-engineering benchmark solver.",
    "Use only the repository snapshot, task, decision options, and memory items in the request below.",
    "Do not inspect or modify the host workspace. Return only the structured response required by the output schema.",
    "Choose exactly one value from scenario.decisionOptions. Return full replacement content for changed allowlisted files.",
    "Trace concise observable actions, not hidden chain-of-thought. Cite only supplied memory that actually influenced the answer.",
    "Request JSON:",
    JSON.stringify(request),
  ].join("\n");
}

async function invokeCodex(options: Options, request: IntegratedAgentRequest): Promise<unknown> {
  await access(options.codexJs);
  const workingDirectory = await mkdtemp(join(tmpdir(), "memoryos-bench-codex-"));
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../protocol/codex-integrated-output.schema.json");
  try {
    const args = [
      options.codexJs,
      "exec",
      "--json",
      "--sandbox", "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--cd", workingDirectory,
      "--output-schema", schemaPath,
      ...(options.model === undefined ? [] : ["--model", options.model]),
      ...(options.reasoningEffort === undefined ? [] : ["-c", `model_reasoning_effort=\"${options.reasoningEffort}\"`]),
      "-",
    ];
    const stdout = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Codex bridge timed out after ${options.timeoutMs} ms.`)));
      }, options.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 10_000_000) {
          child.kill();
          finish(() => reject(new Error("Codex bridge stdout exceeded 10 MB.")));
        }
      });
      child.stderr.on("data", (chunk: string) => { errors += chunk; });
      child.once("error", (error) => finish(() => reject(error)));
      child.once("close", (code) => finish(() => code === 0
        ? resolveOutput(output)
        : reject(new Error(`Codex exited with code ${code ?? "unknown"}: ${errors.slice(0, 4_000)}`))));
      child.stdin.end(promptFor(request));
    });
    const parsed = parseCodexEvents(stdout);
    const modelOutput: z.infer<typeof ModelOutputSchema> = ModelOutputSchema.parse(JSON.parse(parsed.finalText));
    return {
      ...modelOutput,
      cost: {
        input_tokens: parsed.usage.inputTokens,
        output_tokens: parsed.usage.outputTokens,
        cached_tokens: parsed.usage.cachedTokens,
        api_cost: null,
        local_compute_time_ms: null,
      },
    };
  } finally {
    const resolvedTemp = resolve(tmpdir());
    const resolvedWorking = resolve(workingDirectory);
    if (resolvedWorking.startsWith(`${resolvedTemp}\\`) || resolvedWorking.startsWith(`${resolvedTemp}/`)) {
      await rm(resolvedWorking, { recursive: true, force: true });
    }
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const request = JSON.parse(await readStdin()) as IntegratedAgentRequest;
  const output = await invokeCodex(options, request);
  process.stdout.write(`${JSON.stringify({ output })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
