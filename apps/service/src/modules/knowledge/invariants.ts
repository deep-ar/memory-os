import type {
  ApplyMemoryDeltaCommand,
  ClaimDraft,
  EntityId,
  EvidenceDraft,
  ProjectSnapshot,
} from "./types.js";

export type KnowledgeIssueCode =
  | "PROJECT_BOUNDARY_VIOLATION"
  | "DUPLICATE_ENTITY_ID"
  | "INVALID_REFERENCE"
  | "INVALID_TEMPORAL_RANGE"
  | "INVALID_EPISTEMIC_BASIS"
  | "SENSITIVE_EVIDENCE";

export interface KnowledgeIssue {
  readonly code: KnowledgeIssueCode;
  readonly path: string;
  readonly message: string;
}

const SENSITIVE_VALUE_PLACEHOLDERS = new Set([
  "changed",
  "example",
  "masked",
  "not-set",
  "placeholder",
  "redacted",
  "removed",
  "unset",
]);

const STRONG_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /:\/\/[^\s/:@]+:[^\s/@]{4,}@/u,
];

const CREDENTIAL_ASSIGNMENT =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret)\b\s*[:=]\s*["']?([^\s"',;}{]{8,})/giu;

function containsSecretMaterial(value: string): boolean {
  if (STRONG_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  for (const match of value.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const assignedValue = match[1]?.toLowerCase();
    if (assignedValue !== undefined && !SENSITIVE_VALUE_PLACEHOLDERS.has(assignedValue)) {
      return true;
    }
  }

  return false;
}

function validateEvidence(item: EvidenceDraft, index: number): KnowledgeIssue[] {
  const fields: ReadonlyArray<readonly [keyof EvidenceDraft, string | null]> = [
    ["summary", item.summary],
    ["content", item.content],
    ["sourceUri", item.sourceUri],
    ["command", item.command],
    ["result", item.result],
    ["quote", item.quote],
  ];

  return fields.flatMap(([field, value]) =>
    value !== null && containsSecretMaterial(value)
      ? [{
          code: "SENSITIVE_EVIDENCE" as const,
          path: `delta.evidence[${index}].${field}`,
          message: "Evidence must not contain credential or private-key material",
        }]
      : [],
  );
}

function duplicateIds(
  ids: readonly EntityId[],
  existing: ReadonlySet<EntityId>,
  path: string,
): KnowledgeIssue[] {
  const seen = new Set<EntityId>();
  const issues: KnowledgeIssue[] = [];

  ids.forEach((id, index) => {
    if (seen.has(id) || existing.has(id)) {
      issues.push({
        code: "DUPLICATE_ENTITY_ID",
        path: `${path}[${index}].id`,
        message: `Entity id '${id}' already exists in this entity namespace`,
      });
    }
    seen.add(id);
  });

  return issues;
}

function requireReferences(
  references: readonly EntityId[],
  available: ReadonlySet<EntityId>,
  path: string,
): KnowledgeIssue[] {
  return references.flatMap((id, index) =>
    available.has(id)
      ? []
      : [
          {
            code: "INVALID_REFERENCE" as const,
            path: `${path}[${index}]`,
            message: `Referenced entity '${id}' does not exist`,
          },
        ],
  );
}

function validateClaim(
  claim: ClaimDraft,
  index: number,
  concepts: ReadonlySet<EntityId>,
  claims: ReadonlySet<EntityId>,
  evidence: ReadonlySet<EntityId>,
  contexts: ReadonlySet<EntityId>,
): KnowledgeIssue[] {
  const path = `delta.claims[${index}]`;
  const issues: KnowledgeIssue[] = [];

  issues.push(...requireReferences([claim.subjectId], concepts, `${path}.subjectId`));
  if (claim.objectId !== null) {
    issues.push(...requireReferences([claim.objectId], concepts, `${path}.objectId`));
  }
  issues.push(...requireReferences(claim.contextIds, contexts, `${path}.contextIds`));
  issues.push(...requireReferences(claim.evidenceIds, evidence, `${path}.evidenceIds`));
  issues.push(
    ...requireReferences(
      [
        ...claim.supports,
        ...claim.contradicts,
        ...claim.supersedes,
        ...claim.refines,
        ...claim.derivedFrom,
      ],
      claims,
      `${path}.claimRelations`,
    ),
  );

  if (claim.epistemicBasis === "inferred" && claim.derivedFrom.length === 0) {
    issues.push({
      code: "INVALID_EPISTEMIC_BASIS",
      path: `${path}.derivedFrom`,
      message: "An inferred Claim must reference at least one source Claim",
    });
  }

  if (
    claim.validFrom !== null &&
    claim.validTo !== null &&
    Date.parse(claim.validTo) < Date.parse(claim.validFrom)
  ) {
    issues.push({
      code: "INVALID_TEMPORAL_RANGE",
      path: `${path}.validTo`,
      message: "validTo must not be earlier than validFrom",
    });
  }

  return issues;
}

export function validateCreateMemoryDelta(
  command: ApplyMemoryDeltaCommand,
  snapshot: ProjectSnapshot,
): readonly KnowledgeIssue[] {
  const { projectId, delta } = command;
  const issues: KnowledgeIssue[] = [];
  const scopedEntities = [
    ...delta.concepts,
    ...delta.claims,
    ...delta.evidence,
    ...delta.contexts,
  ];

  scopedEntities.forEach((entity, index) => {
    if (entity.projectId !== projectId) {
      issues.push({
        code: "PROJECT_BOUNDARY_VIOLATION",
        path: `delta.entities[${index}].projectId`,
        message: `Entity '${entity.id}' belongs to '${entity.projectId}', expected '${projectId}'`,
      });
    }
  });

  issues.push(
    ...duplicateIds(
      delta.concepts.map((concept) => concept.id),
      snapshot.conceptIds,
      "delta.concepts",
    ),
    ...duplicateIds(
      delta.claims.map((claim) => claim.id),
      snapshot.claimIds,
      "delta.claims",
    ),
    ...duplicateIds(
      delta.evidence.map((item) => item.id),
      snapshot.evidenceIds,
      "delta.evidence",
    ),
    ...duplicateIds(
      delta.contexts.map((context) => context.id),
      snapshot.contextIds,
      "delta.contexts",
    ),
  );

  const concepts = new Set([
    ...snapshot.conceptIds,
    ...delta.concepts.map((concept) => concept.id),
  ]);
  const claims = new Set([
    ...snapshot.claimIds,
    ...delta.claims.map((claim) => claim.id),
  ]);
  const evidence = new Set([
    ...snapshot.evidenceIds,
    ...delta.evidence.map((item) => item.id),
  ]);
  const contexts = new Set([
    ...snapshot.contextIds,
    ...delta.contexts.map((context) => context.id),
  ]);

  delta.contexts.forEach((context, index) => {
    issues.push(
      ...requireReferences(
        context.conceptIds,
        concepts,
        `delta.contexts[${index}].conceptIds`,
      ),
    );
  });

  delta.evidence.forEach((item, index) => {
    issues.push(...validateEvidence(item, index));
  });

  delta.claims.forEach((claim, index) => {
    issues.push(...validateClaim(claim, index, concepts, claims, evidence, contexts));
  });

  return issues;
}
