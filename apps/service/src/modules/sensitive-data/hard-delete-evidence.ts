import type {
  HardDeleteEvidenceCommand,
  HardDeleteEvidenceResult,
  SensitiveDataDeletionStore,
} from "./types.js";

export function createHardDeleteEvidence(dependencies: {
  readonly store: SensitiveDataDeletionStore;
  readonly clock: { now(): string };
  readonly ids: { nextId(): string };
  readonly hash: { sha256(value: string): string };
}) {
  return async (command: HardDeleteEvidenceCommand): Promise<HardDeleteEvidenceResult> => {
    const deletedAt = dependencies.clock.now();
    const auditId = dependencies.ids.nextId();
    const deleted = await dependencies.store.hardDeleteEvidence({
      auditId,
      projectId: command.projectId,
      entityType: "Evidence",
      entityIdHash: dependencies.hash.sha256(command.evidenceId),
      reason: command.reason,
      actor: command.actor,
      deletedAt,
    }, command.evidenceId);
    return deleted
      ? { ok: true, auditId, deletedAt }
      : { ok: false, code: "EVIDENCE_NOT_FOUND" };
  };
}
