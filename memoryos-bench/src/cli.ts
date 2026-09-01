#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadDataset } from "./adapters/load-dataset.js";
import { discoverCodexSessions, readCodexSession } from "./adapters/codex-session-reader.js";
import { MemoryOsPublicBackend } from "./adapters/memoryos-backend.js";
import { LiveIntegratedMemoryContextProvider } from "./adapters/live-integrated-context.js";
import { MemoryOsRealReplayContextProvider } from "./adapters/memoryos-real-replay-context.js";
import { prepareJsonReportTarget, writeJsonReport } from "./adapters/json-report-store.js";
import type { CuratorAgent } from "./curator/agent.js";
import { loadCuratorDataset } from "./curator/load-curator-dataset.js";
import { ReplayCuratorAgent } from "./curator/replay-agent.js";
import { runCuratorBenchmark } from "./curator/run-curator-benchmark.js";
import { StdioCuratorAgent } from "./curator/stdio-agent.js";
import type { IntegratedAgent, IntegratedMemoryContextProvider } from "./integrated/agent.js";
import { FixtureIntegratedMemoryContextProvider } from "./integrated/agent.js";
import { loadIntegratedDataset } from "./integrated/load-integrated-dataset.js";
import { ReplayIntegratedAgent } from "./integrated/replay-agent.js";
import { parseRegradeableIntegratedReport, regradeIntegratedReport } from "./integrated/regrade-integrated-report.js";
import { runIntegratedBenchmark } from "./integrated/run-integrated-benchmark.js";
import { StdioIntegratedAgent } from "./integrated/stdio-agent.js";
import { runKernelBenchmark } from "./kernel/run-benchmark.js";
import { loadRealReplayBundle, loadRealReplayCheckpointSpec } from "./real-replay/load-real-replay.js";
import { prepareRealReplayBundle } from "./real-replay/prepare-real-replay.js";
import { runRealReplay } from "./real-replay/run-real-replay.js";
import { runRealReplayRetrievalAudit } from "./real-replay/run-retrieval-audit.js";
import { compileSemanticDataset } from "./semantic/compile-semantic-dataset.js";
import { compileSemanticIncrement } from "./semantic/compile-semantic-increment.js";
import { loadSemanticKnowledgeIncrementSpec } from "./semantic/load-semantic-increment-spec.js";
import { loadSemanticKnowledgeSpec } from "./semantic/load-semantic-spec.js";
import { runSemanticContextAudit } from "./semantic/run-context-audit.js";
import {
  composeCombinedReport,
  parseCuratorReport,
  parseIntegratedReport,
  parseKernelReport,
} from "./reporting/combined-report.js";
import { loadJsonReport } from "./reporting/load-report.js";

interface KernelOptions {
  readonly dataset: string;
  readonly url: string;
  readonly output: string;
  readonly authToken?: string;
  readonly allowExistingProjects: boolean;
}

interface ParsedArguments {
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memoryos-bench kernel --dataset <dataset.json> --url <MemoryOS URL> --output <report.json>",
    "                        [--auth-token <token>] [--allow-existing-projects]",
    "  memoryos-bench curator --dataset <episodes.json> --responses <replay.json> --output <report.json>",
    "  memoryos-bench curator --dataset <episodes.json> --agent-command <executable> --output <report.json>",
    "                         --agent-provider <provider> --agent-model <model> --agent-version <version>",
    "                         [--agent-arg <arg>]... [--reasoning-mode <mode>] [--timeout-ms <milliseconds>]",
    "  memoryos-bench integrated --dataset <scenarios.json> --responses <replay.json> --output <report.json>",
    "  memoryos-bench integrated --dataset <scenarios.json> --agent-command <executable> --output <report.json>",
    "                            --agent-provider <provider> --agent-model <model> --agent-version <version>",
    "                            [--agent-arg <arg>]... [--reasoning-mode <mode>] [--timeout-ms <milliseconds>]",
    "                            [--memory-provider fixture|live] [--memoryos-url <url>] [--auth-token <token>]",
    "                            [--ollama-url <url>] [--ollama-model <model>] [--flat-rag-limit <count>]",
    "  memoryos-bench report --kernel <kernel-report.json> --curator <curator-report.json>",
    "                        --integrated <integrated-report.json> --output <combined-report.json>",
    "  memoryos-bench regrade --integrated <integrated-report.json> --reason <text> --output <report.json>",
    "  memoryos-bench real-replay-prepare --sessions-root <directory> --cwd <project directory>",
    "                                      --checkpoint-spec <spec.json> --output <bundle.json>",
    "  memoryos-bench real-replay-run --bundle <bundle.json> --memoryos-url <url>",
    "                                  --agent-command <executable> --output <report.json>",
    "                                  --agent-provider <provider> --agent-model <model> --agent-version <version>",
    "                                  [--agent-arg <arg>]... [--reasoning-mode <mode>] [--timeout-ms <milliseconds>]",
    "                                  [--auth-token <token>] [--memory-token-budget <tokens>]",
    "  memoryos-bench real-replay-retrieval --bundle <bundle.json> --memoryos-url <url> --output <report.json>",
    "                                        [--auth-token <token>] [--memory-token-budget <tokens>]",
    "  memoryos-bench semantic-compile --source-bundle <bundle.json> --spec <semantic-spec.json>",
    "                                  --output <dataset.json>",
    "  memoryos-bench semantic-increment-compile --source-session <session.jsonl> --base-spec <semantic-spec.json>",
    "                                            --spec <increment-spec.json> --output <dataset.json>",
    "  memoryos-bench semantic-context-audit --dataset <dataset.json> --memoryos-url <url>",
    "                                        --output <report.json> [--token-budget <tokens>] [--spec <semantic-spec.json>]",
    "                                        [--auth-token <token>]",
    "",
    "The default safety policy refuses to run when a dataset project already exists.",
  ].join("\n");
}

function parseNamedArguments(args: readonly string[], booleanFlags: ReadonlySet<string>): ParsedArguments {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const equalsIndex = argument?.indexOf("=") ?? -1;
    if (argument !== undefined && argument.startsWith("--") && equalsIndex > 2) {
      const name = argument.slice(0, equalsIndex);
      const value = argument.slice(equalsIndex + 1);
      if (booleanFlags.has(name)) throw new Error(`Flag '${name}' does not accept a value.\n${usage()}`);
      if (value.length === 0) throw new Error(`Missing value for '${name}'.\n${usage()}`);
      values.set(name, [...(values.get(name) ?? []), value]);
      continue;
    }
    if (argument !== undefined && booleanFlags.has(argument)) {
      flags.add(argument);
      continue;
    }
    if (argument === undefined || !argument.startsWith("--")) throw new Error(`Unexpected argument '${argument}'.\n${usage()}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for '${argument}'.\n${usage()}`);
    values.set(argument, [...(values.get(argument) ?? []), value]);
    index += 1;
  }
  return { values, flags };
}

function one(parsed: ParsedArguments, name: string): string | undefined {
  const values = parsed.values.get(name);
  if (values !== undefined && values.length > 1 && name !== "--agent-arg") {
    throw new Error(`Argument '${name}' may only be supplied once.`);
  }
  return values?.[0];
}

function requireOne(parsed: ParsedArguments, name: string): string {
  const value = one(parsed, name);
  if (value === undefined) throw new Error(`Missing required argument '${name}'.\n${usage()}`);
  return value;
}

function parseKernelOptions(args: readonly string[]): KernelOptions {
  const parsed = parseNamedArguments(args, new Set(["--allow-existing-projects"]));
  const dataset = one(parsed, "--dataset");
  const url = one(parsed, "--url");
  const output = one(parsed, "--output");
  if (dataset === undefined || url === undefined || output === undefined) throw new Error(usage());
  const authToken = one(parsed, "--auth-token");
  return {
    dataset,
    url,
    output,
    ...(authToken === undefined ? {} : { authToken }),
    allowExistingProjects: parsed.flags.has("--allow-existing-projects"),
  };
}

async function runKernel(args: readonly string[]): Promise<void> {
  const options = parseKernelOptions(args);
  await prepareJsonReportTarget(options.output);
  const loaded = await loadDataset(options.dataset);
  const backend = new MemoryOsPublicBackend({
    serviceUrl: options.url,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
  });
  try {
    const report = await runKernelBenchmark({
      ...loaded,
      backend,
      allowExistingProjects: options.allowExistingProjects,
    });
    const output = await writeJsonReport(report, options.output);
    process.stdout.write(`${JSON.stringify({ status: report.status, output, summary: report.summary }, null, 2)}\n`);
    if (report.status !== "completed") process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

async function createCuratorAgent(parsed: ParsedArguments): Promise<CuratorAgent> {
  const responses = one(parsed, "--responses");
  const executable = one(parsed, "--agent-command");
  if ((responses === undefined) === (executable === undefined)) {
    throw new Error("Curator requires exactly one of --responses or --agent-command.");
  }
  if (responses !== undefined) return ReplayCuratorAgent.load(responses);
  const timeoutText = one(parsed, "--timeout-ms");
  const timeoutMs = timeoutText === undefined ? undefined : Number(timeoutText);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  const reasoningMode = one(parsed, "--reasoning-mode");
  return new StdioCuratorAgent({
    executable: executable as string,
    args: parsed.values.get("--agent-arg") ?? [],
    provider: requireOne(parsed, "--agent-provider"),
    model: requireOne(parsed, "--agent-model"),
    version: requireOne(parsed, "--agent-version"),
    ...(reasoningMode === undefined ? {} : { reasoningMode }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function runCurator(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const datasetPath = requireOne(parsed, "--dataset");
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const [loaded, agent] = await Promise.all([
    loadCuratorDataset(datasetPath),
    createCuratorAgent(parsed),
  ]);
  try {
    const report = await runCuratorBenchmark({ ...loaded, agent });
    const output = await writeJsonReport(report, outputPath);
    process.stdout.write(`${JSON.stringify({ status: report.status, output, summary: report.summary }, null, 2)}\n`);
    if (report.status !== "completed") process.exitCode = 1;
  } finally {
    await agent.close();
  }
}

async function createIntegratedAgent(parsed: ParsedArguments): Promise<IntegratedAgent> {
  const responses = one(parsed, "--responses");
  const executable = one(parsed, "--agent-command");
  if ((responses === undefined) === (executable === undefined)) {
    throw new Error("Integrated requires exactly one of --responses or --agent-command.");
  }
  if (responses !== undefined) return ReplayIntegratedAgent.load(responses);
  const timeoutText = one(parsed, "--timeout-ms");
  const timeoutMs = timeoutText === undefined ? undefined : Number(timeoutText);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  const reasoningMode = one(parsed, "--reasoning-mode");
  return new StdioIntegratedAgent({
    executable: executable as string,
    args: parsed.values.get("--agent-arg") ?? [],
    provider: requireOne(parsed, "--agent-provider"),
    model: requireOne(parsed, "--agent-model"),
    version: requireOne(parsed, "--agent-version"),
    ...(reasoningMode === undefined ? {} : { reasoningMode }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function runIntegrated(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const datasetPath = requireOne(parsed, "--dataset");
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const [loaded, agent] = await Promise.all([loadIntegratedDataset(datasetPath), createIntegratedAgent(parsed)]);
  const providerKind = one(parsed, "--memory-provider") ?? "fixture";
  let memoryProvider: IntegratedMemoryContextProvider;
  if (providerKind === "fixture") {
    memoryProvider = new FixtureIntegratedMemoryContextProvider();
  } else if (providerKind === "live") {
    const limitText = one(parsed, "--flat-rag-limit");
    const flatRagLimit = limitText === undefined ? undefined : Number(limitText);
    if (flatRagLimit !== undefined && (!Number.isInteger(flatRagLimit) || flatRagLimit < 1)) {
      throw new Error("--flat-rag-limit must be a positive integer.");
    }
    const authToken = one(parsed, "--auth-token");
    memoryProvider = new LiveIntegratedMemoryContextProvider({
      dataset: loaded.dataset,
      memoryosUrl: requireOne(parsed, "--memoryos-url"),
      ollamaUrl: one(parsed, "--ollama-url") ?? "http://127.0.0.1:11434",
      ollamaModel: one(parsed, "--ollama-model") ?? "bge-m3",
      ...(authToken === undefined ? {} : { authToken }),
      ...(flatRagLimit === undefined ? {} : { flatRagLimit }),
    });
  } else {
    throw new Error("--memory-provider must be 'fixture' or 'live'.");
  }
  try {
    const report = await runIntegratedBenchmark({
      ...loaded,
      agent,
      memoryProvider,
    });
    const output = await writeJsonReport(report, outputPath);
    process.stdout.write(`${JSON.stringify({ status: report.status, output, metrics: report.metrics }, null, 2)}\n`);
    if (report.status !== "completed") process.exitCode = 1;
  } finally {
    await Promise.all([agent.close(), memoryProvider.close()]);
  }
}

async function runCombinedReport(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const [kernel, curator, integrated] = await Promise.all([
    loadJsonReport(requireOne(parsed, "--kernel"), parseKernelReport),
    loadJsonReport(requireOne(parsed, "--curator"), parseCuratorReport),
    loadJsonReport(requireOne(parsed, "--integrated"), parseIntegratedReport),
  ]);
  const report = composeCombinedReport({ kernel, curator, integrated });
  const output = await writeJsonReport(report, outputPath);
  process.stdout.write(`${JSON.stringify({ status: report.status, output, warnings: report.warnings }, null, 2)}\n`);
  if (report.status !== "completed") process.exitCode = 1;
}

async function runRegrade(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  const loaded = await loadJsonReport(requireOne(parsed, "--integrated"), parseRegradeableIntegratedReport);
  const report = regradeIntegratedReport({
    ...loaded,
    reason: requireOne(parsed, "--reason"),
  });
  const output = await writeJsonReport(report, outputPath);
  process.stdout.write(`${JSON.stringify({ status: report.status, output, regrade: report.regrade }, null, 2)}\n`);
  if (report.status !== "completed") process.exitCode = 1;
}

async function prepareRealSessionReplay(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const checkpointSpec = await loadRealReplayCheckpointSpec(requireOne(parsed, "--checkpoint-spec"));
  const discovered = await discoverCodexSessions({
    sessionsRoot: requireOne(parsed, "--sessions-root"),
    workspaceCwd: requireOne(parsed, "--cwd"),
  });
  const roots = discovered.filter((session) => typeof session.meta.source === "string");
  const transcripts = [];
  for (const root of roots) transcripts.push(await readCodexSession(root.path));
  const latest = transcripts.at(-1);
  if (latest?.metadata.session_id !== checkpointSpec.holdout_session_id) {
    throw new Error(`Checkpoint holdout '${checkpointSpec.holdout_session_id}' is not the latest discovered root session '${latest?.metadata.session_id ?? "none"}'.`);
  }
  const bundle = prepareRealReplayBundle({
    sessions: transcripts,
    checkpointSpec,
    excludedSubagentSessions: discovered.length - roots.length,
  });
  const output = await writeJsonReport(bundle, outputPath);
  process.stdout.write(`${JSON.stringify({
    status: "prepared",
    output,
    rootSessions: roots.length,
    excludedSubagentSessions: discovered.length - roots.length,
    trainSessions: bundle.split.train_sessions.length,
    memoryCards: bundle.memory.cards,
    checkpoints: bundle.evaluation.checkpoints.length,
    goldStatus: bundle.evaluation.gold_status,
  }, null, 2)}\n`);
}

async function runRealSessionReplay(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const loaded = await loadRealReplayBundle(requireOne(parsed, "--bundle"));
  const agent = await createIntegratedAgent(parsed);
  const provider = realReplayProvider(parsed, loaded.bundle);
  try {
    const report = await runRealReplay({ ...loaded, agent, memoryProvider: provider });
    const output = await writeJsonReport(report, outputPath);
    process.stdout.write(`${JSON.stringify({ status: report.status, output, memoryPreparation: report.memoryPreparation, metrics: report.metrics }, null, 2)}\n`);
    if (report.status === "failed") process.exitCode = 1;
  } finally {
    await Promise.all([agent.close(), provider.close()]);
  }
}

function realReplayProvider(parsed: ParsedArguments, bundle: Awaited<ReturnType<typeof loadRealReplayBundle>>["bundle"]) {
  const budgetText = one(parsed, "--memory-token-budget");
  const tokenBudget = budgetText === undefined ? undefined : Number(budgetText);
  if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget < 1)) {
    throw new Error("--memory-token-budget must be a positive integer.");
  }
  const authToken = one(parsed, "--auth-token");
  return new MemoryOsRealReplayContextProvider({
    bundle,
    serviceUrl: requireOne(parsed, "--memoryos-url"),
    ...(authToken === undefined ? {} : { authToken }),
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
  });
}

async function runRealSessionRetrievalAudit(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const loaded = await loadRealReplayBundle(requireOne(parsed, "--bundle"));
  const provider = realReplayProvider(parsed, loaded.bundle);
  try {
    const report = await runRealReplayRetrievalAudit({ ...loaded, memoryProvider: provider });
    const output = await writeJsonReport(report, outputPath);
    process.stdout.write(`${JSON.stringify({ status: report.status, output, memoryPreparation: report.memoryPreparation, observations: report.observations.length }, null, 2)}\n`);
    if (report.status === "failed") process.exitCode = 1;
  } finally {
    await provider.close();
  }
}

async function compileSemanticKnowledge(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  await prepareJsonReportTarget(outputPath);
  const [source, spec] = await Promise.all([
    loadRealReplayBundle(requireOne(parsed, "--source-bundle")),
    loadSemanticKnowledgeSpec(requireOne(parsed, "--spec")),
  ]);
  const dataset = compileSemanticDataset({
    spec,
    sourceBundle: source.bundle,
    sourceBundleSha256: source.descriptor.sha256,
  });
  const output = await writeJsonReport(dataset, outputPath);
  process.stdout.write(`${JSON.stringify({
    status: "compiled",
    output,
    projectId: dataset.projects[0]?.id,
    concepts: dataset.deltas[0]?.memory_delta.concepts.length ?? 0,
    claims: dataset.deltas[0]?.memory_delta.claims.length ?? 0,
    evidence: dataset.deltas[0]?.memory_delta.evidence.length ?? 0,
    questions: dataset.probes.length,
  }, null, 2)}\n`);
}

async function compileSemanticKnowledgeIncrement(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  const baseSpecPath = requireOne(parsed, "--base-spec");
  await prepareJsonReportTarget(outputPath);
  const [sourceSession, baseSpec, incrementSpec, baseRaw] = await Promise.all([
    readCodexSession(requireOne(parsed, "--source-session")),
    loadSemanticKnowledgeSpec(baseSpecPath),
    loadSemanticKnowledgeIncrementSpec(requireOne(parsed, "--spec")),
    readFile(baseSpecPath),
  ]);
  const dataset = compileSemanticIncrement({
    spec: incrementSpec,
    baseSpec,
    baseSpecSha256: createHash("sha256").update(baseRaw).digest("hex"),
    sourceSession,
  });
  const output = await writeJsonReport(dataset, outputPath);
  process.stdout.write(`${JSON.stringify({
    status: "compiled",
    output,
    projectId: dataset.projects[0]?.id,
    expectedRevision: dataset.deltas[0]?.memory_delta.expected_revision,
    concepts: dataset.deltas[0]?.memory_delta.concepts.length ?? 0,
    claims: dataset.deltas[0]?.memory_delta.claims.length ?? 0,
    evidence: dataset.deltas[0]?.memory_delta.evidence.length ?? 0,
    questions: dataset.probes.length,
  }, null, 2)}\n`);
}

async function auditSemanticContext(args: readonly string[]): Promise<void> {
  const parsed = parseNamedArguments(args, new Set());
  const outputPath = requireOne(parsed, "--output");
  const tokenBudgetText = one(parsed, "--token-budget");
  const tokenBudget = tokenBudgetText === undefined ? 6_000 : Number(tokenBudgetText);
  if (!Number.isInteger(tokenBudget) || tokenBudget < 1) throw new Error("--token-budget must be a positive integer.");
  await prepareJsonReportTarget(outputPath);
  const loaded = await loadDataset(requireOne(parsed, "--dataset"));
  const specPath = one(parsed, "--spec");
  const spec = specPath === undefined ? undefined : await loadSemanticKnowledgeSpec(specPath);
  const authToken = one(parsed, "--auth-token");
  const report = await runSemanticContextAudit({
    ...loaded,
    serviceUrl: requireOne(parsed, "--memoryos-url"),
    tokenBudget,
    ...(spec === undefined ? {} : {
      queriesByProbeId: new Map(spec.questions
        .filter((question) => question.retrieval_queries !== undefined)
        .map((question) => [question.id, question.retrieval_queries!] as const)),
    }),
    ...(authToken === undefined ? {} : { authToken }),
  });
  const output = await writeJsonReport(report, outputPath);
  process.stdout.write(`${JSON.stringify({ status: "completed", output, summary: report.summary }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "kernel") return runKernel(args);
  if (command === "curator") return runCurator(args);
  if (command === "integrated") return runIntegrated(args);
  if (command === "report") return runCombinedReport(args);
  if (command === "regrade") return runRegrade(args);
  if (command === "real-replay-prepare") return prepareRealSessionReplay(args);
  if (command === "real-replay-run") return runRealSessionReplay(args);
  if (command === "real-replay-retrieval") return runRealSessionRetrievalAudit(args);
  if (command === "semantic-compile") return compileSemanticKnowledge(args);
  if (command === "semantic-increment-compile") return compileSemanticKnowledgeIncrement(args);
  if (command === "semantic-context-audit") return auditSemanticContext(args);
  throw new Error(usage());
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
