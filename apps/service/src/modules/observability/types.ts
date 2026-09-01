export type OperationOutcome = "success" | "conflict" | "failure";

export interface OperationMetricRecorder {
  recordOperation(operation: string, outcome: OperationOutcome, durationMilliseconds: number): void;
}

export interface OperationMetricSnapshot {
  readonly operation: string;
  readonly outcome: OperationOutcome;
  readonly count: number;
  readonly durationMilliseconds: number;
}

export interface OperationMetricsReader {
  operationMetrics(): readonly OperationMetricSnapshot[];
}

export interface OperationTrace {
  readonly operation: string;
  readonly outcome: OperationOutcome;
  readonly projectId: string;
  readonly agentId: string | null;
  readonly sessionId: string | null;
  readonly reflectionEventId: string | null;
  readonly failureReason: string | null;
}

export interface OperationTraceSink {
  recordTrace(trace: OperationTrace): void;
}
