export type EmbeddingFailureReason =
  | "MODEL_NOT_FOUND"
  | "REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "MODEL_CHANGED"
  | "DIMENSION_MISMATCH"
  | "NON_FINITE_VECTOR";

export class EmbeddingFailure extends Error {
  readonly code = "EMBEDDING_FAILURE" as const;

  constructor(
    readonly reason: EmbeddingFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmbeddingFailure";
  }
}
