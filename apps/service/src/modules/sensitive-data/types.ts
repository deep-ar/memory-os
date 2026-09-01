export type HardDeleteReason = "credential" | "privacy" | "legal" | "other";

export interface HardDeleteEvidenceCommand {
  readonly projectId: string;
  readonly evidenceId: string;
  readonly reason: HardDeleteReason;
  readonly actor: string;
}

export interface HardDeleteRecord {
  readonly auditId: string;
  readonly projectId: string;
  readonly entityType: "Evidence";
  readonly entityIdHash: string;
  readonly reason: HardDeleteReason;
  readonly actor: string;
  readonly deletedAt: string;
}

export interface SensitiveDataDeletionStore {
  hardDeleteEvidence(record: HardDeleteRecord, evidenceId: string): Promise<boolean>;
}

export type HardDeleteEvidenceResult =
  | { readonly ok: true; readonly auditId: string; readonly deletedAt: string }
  | { readonly ok: false; readonly code: "EVIDENCE_NOT_FOUND" };
