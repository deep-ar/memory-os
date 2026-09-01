import type { IntegratedAgentOutput } from "./agent.js";
import type { IntegratedScenario } from "./dataset.js";

export interface WorkspaceValidation {
  readonly success: boolean;
  readonly decisionCorrect: boolean;
  readonly filesCorrect: boolean;
  readonly failures: readonly string[];
  readonly finalFiles: Readonly<Record<string, string>>;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
      ([key, nested]) => [key, canonicalJson(nested)],
    ));
  }
  return value;
}

function equivalentContent(path: string, actual: string, expected: string): boolean {
  if (!path.toLowerCase().endsWith(".json")) return actual === expected;
  try {
    return JSON.stringify(canonicalJson(JSON.parse(actual))) === JSON.stringify(canonicalJson(JSON.parse(expected)));
  } catch {
    return actual === expected;
  }
}

export function evaluateWorkspaceResult(
  scenario: IntegratedScenario,
  output: IntegratedAgentOutput,
): WorkspaceValidation {
  const files = new Map(Object.entries(scenario.repository.files));
  const allowed = new Set(scenario.repository.allowed_change_paths);
  const changed = new Set<string>();
  const failures: string[] = [];
  for (const change of output.changes) {
    if (!allowed.has(change.path)) {
      failures.push(`Change path '${change.path}' is outside the scenario allowlist.`);
      continue;
    }
    if (changed.has(change.path)) {
      failures.push(`Change path '${change.path}' is repeated.`);
      continue;
    }
    changed.add(change.path);
    files.set(change.path, change.content);
  }
  const decisionCorrect = output.decision === scenario.validator.expected_decision;
  if (!decisionCorrect) failures.push(`Decision '${output.decision}' does not match expected decision.`);
  let filesCorrect = true;
  for (const [path, expected] of Object.entries(scenario.validator.expected_files)) {
    if (!equivalentContent(path, files.get(path) ?? "", expected)) {
      filesCorrect = false;
      failures.push(`File '${path}' does not match expected content.`);
    }
  }
  return {
    success: decisionCorrect && filesCorrect && failures.length === 0,
    decisionCorrect,
    filesCorrect,
    failures,
    finalFiles: Object.fromEntries([...files.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}
