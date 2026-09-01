import type { IntegrityReport } from "../../modules/integrity/index.js";
import type {
  OperationMetricRecorder,
  OperationMetricSnapshot,
  OperationMetricsReader,
  OperationOutcome,
} from "../../modules/observability/index.js";

interface MutableMetric { count: number; durationMilliseconds: number }

function labels(operation: string, outcome: OperationOutcome): string {
  return `operation="${operation}",outcome="${outcome}"`;
}

export class LocalMetricsRegistry implements OperationMetricRecorder, OperationMetricsReader {
  readonly #operations = new Map<string, MutableMetric>();

  recordOperation(operation: string, outcome: OperationOutcome, durationMilliseconds: number): void {
    const key = `${operation}\0${outcome}`;
    const current = this.#operations.get(key) ?? { count: 0, durationMilliseconds: 0 };
    current.count += 1;
    current.durationMilliseconds += Math.max(0, durationMilliseconds);
    this.#operations.set(key, current);
  }

  operationMetrics(): readonly OperationMetricSnapshot[] {
    return [...this.#operations.entries()].map(([key, metric]) => {
      const [operation, outcome] = key.split("\0") as [string, OperationOutcome];
      return { operation, outcome, ...metric };
    }).sort((left, right) => left.operation.localeCompare(right.operation)
      || left.outcome.localeCompare(right.outcome));
  }

  renderPrometheus(integrity: IntegrityReport): string {
    const lines = [
      "# HELP memoryos_operation_total MemoryOS application operations by outcome.",
      "# TYPE memoryos_operation_total counter",
    ];
    for (const metric of this.operationMetrics()) {
      lines.push(`memoryos_operation_total{${labels(metric.operation, metric.outcome)}} ${metric.count}`);
    }
    lines.push(
      "# HELP memoryos_operation_duration_seconds MemoryOS cumulative application operation duration.",
      "# TYPE memoryos_operation_duration_seconds counter",
    );
    for (const metric of this.operationMetrics()) {
      lines.push(`memoryos_operation_duration_seconds{${labels(metric.operation, metric.outcome)}} ${(metric.durationMilliseconds / 1_000).toFixed(6)}`);
    }
    lines.push(
      "# HELP memoryos_integrity_healthy Whether the latest integrity check is healthy.",
      "# TYPE memoryos_integrity_healthy gauge",
      `memoryos_integrity_healthy ${integrity.status === "healthy" ? 1 : 0}`,
      "# TYPE memoryos_projects gauge",
      `memoryos_projects ${integrity.counts.projects}`,
      "# TYPE memoryos_concepts gauge",
      `memoryos_concepts ${integrity.counts.concepts}`,
      "# TYPE memoryos_claims gauge",
      `memoryos_claims ${integrity.counts.claims}`,
      "# TYPE memoryos_evidence gauge",
      `memoryos_evidence ${integrity.counts.evidence}`,
      "# TYPE memoryos_reflection_events gauge",
      `memoryos_reflection_events ${integrity.counts.reflectionEvents}`,
      "# TYPE memoryos_claims_by_lifecycle gauge",
      `memoryos_claims_by_lifecycle{status="active"} ${integrity.counts.activeClaims ?? 0}`,
      `memoryos_claims_by_lifecycle{status="disputed"} ${integrity.counts.disputedClaims ?? 0}`,
      `memoryos_claims_by_lifecycle{status="superseded"} ${integrity.counts.supersededClaims ?? 0}`,
      `memoryos_claims_by_lifecycle{status="invalidated"} ${integrity.counts.invalidatedClaims ?? 0}`,
      "",
    );
    return lines.join("\n");
  }
}
