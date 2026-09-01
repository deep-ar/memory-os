import type { CuratorEpisode, CuratorOutput, WireMemoryDelta } from "./dataset.js";

export interface BinaryMetrics {
  readonly truePositive: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
}

export interface AccuracyMetric {
  readonly correct: number;
  readonly total: number;
  readonly accuracy: number | null;
}

export interface CuratorMetrics {
  readonly admission: BinaryMetrics & {
    readonly falseDurableKnowledge: number;
    readonly precisionWeightedForFalseDurability: number | null;
  };
  readonly concepts: BinaryMetrics;
  readonly duplicateConceptRate: number | null;
  readonly claimTriples: BinaryMetrics;
  readonly epistemicBasis: AccuracyMetric;
  readonly confidenceTransition: AccuracyMetric;
  readonly evidence: BinaryMetrics;
  readonly evidenceLinks: BinaryMetrics;
  readonly contexts: BinaryMetrics;
  readonly contextLinks: BinaryMetrics;
  readonly overGeneralization: {
    readonly scopedClaims: number;
    readonly overGeneralizedClaims: number;
    readonly rate: number | null;
  };
  readonly temporalClassification: AccuracyMetric;
  readonly validRange: AccuracyMetric;
  readonly conflictRelations: BinaryMetrics;
  readonly promotion: {
    readonly precision: number | null;
    readonly recall: number | null;
    readonly falseGeneralizationRate: number | null;
    readonly expected: number;
    readonly forbidden: number;
    readonly expectedProduced: number;
    readonly forbiddenProduced: number;
  };
}

type Claim = WireMemoryDelta["claims"][number];

function setMetrics(expected: ReadonlySet<string>, actual: ReadonlySet<string>): BinaryMetrics {
  const truePositive = [...actual].filter((key) => expected.has(key)).length;
  const falsePositive = [...actual].filter((key) => !expected.has(key)).length;
  const falseNegative = [...expected].filter((key) => !actual.has(key)).length;
  const precision = actual.size === 0 ? null : truePositive / actual.size;
  const recall = expected.size === 0 ? null : truePositive / expected.size;
  const f1 = expected.size === 0 && actual.size === 0
    ? null
    : precision === null || recall === null || precision + recall === 0
      ? 0
      : 2 * precision * recall / (precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

function accuracy(correct: number, total: number): AccuracyMetric {
  return { correct, total, accuracy: total === 0 ? null : correct / total };
}

function claimTriple(claim: Pick<Claim, "subject_id" | "predicate" | "object_id">): string {
  return `${claim.subject_id}\u0000${claim.predicate}\u0000${claim.object_id ?? "<null>"}`;
}

function entityKeys(delta: WireMemoryDelta): Set<string> {
  return new Set([
    ...delta.concepts.map((entity) => `concept:${entity.id}`),
    ...delta.claims.map((entity) => `claim:${entity.id}`),
    ...delta.evidence.map((entity) => `evidence:${entity.id}`),
    ...delta.contexts.map((entity) => `context:${entity.id}`),
  ]);
}

function claimMapByTriple(claims: readonly Claim[]): Map<string, Claim> {
  return new Map(claims.map((claim) => [claimTriple(claim), claim]));
}

function evidenceLinkKeys(delta: WireMemoryDelta): Set<string> {
  return new Set(delta.claims.flatMap((claim) => claim.evidence_ids.map(
    (evidenceId) => `${claimTriple(claim)}\u0000evidence:${evidenceId}`,
  )));
}

function contextLinkKeys(delta: WireMemoryDelta): Set<string> {
  return new Set(delta.claims.flatMap((claim) => claim.context_ids.map(
    (contextId) => `${claimTriple(claim)}\u0000context:${contextId}`,
  )));
}

const relationFields = ["supports", "contradicts", "supersedes", "refines", "derived_from"] as const;

function relationKeys(delta: WireMemoryDelta, priorClaims: readonly Claim[]): Set<string> {
  const claimsById = new Map([...priorClaims, ...delta.claims].map((claim) => [claim.id, claim]));
  const result = new Set<string>();
  for (const claim of delta.claims) {
    for (const relation of relationFields) {
      for (const targetId of claim[relation]) {
        const target = claimsById.get(targetId);
        result.add(`${claimTriple(claim)}\u0000${relation}\u0000${target === undefined ? `unknown:${targetId}` : claimTriple(target)}`);
      }
    }
  }
  return result;
}

function matchedClaimAccuracy(
  goldClaims: readonly Claim[],
  actualByTriple: ReadonlyMap<string, Claim>,
  predicate: (gold: Claim, actual: Claim) => boolean,
): AccuracyMetric {
  let correct = 0;
  let total = 0;
  for (const gold of goldClaims) {
    const actual = actualByTriple.get(claimTriple(gold));
    if (actual === undefined) continue;
    total += 1;
    if (predicate(gold, actual)) correct += 1;
  }
  return accuracy(correct, total);
}

export function scoreCuratorOutput(episode: CuratorEpisode, output: CuratorOutput): CuratorMetrics {
  const gold = episode.gold_output.memory_delta;
  const actual = output.memory_delta;
  const admission = setMetrics(entityKeys(gold), entityKeys(actual));
  const goldClaimTriples = new Set(gold.claims.map(claimTriple));
  const actualClaimTriples = new Set(actual.claims.map(claimTriple));
  const actualClaimsByTriple = claimMapByTriple(actual.claims);
  const uniqueActualConceptIds = new Set(actual.concepts.map((concept) => concept.id));

  const scopedGold = gold.claims.filter((claim) => claim.context_ids.length > 0);
  const overGeneralizedClaims = scopedGold.filter((claim) => {
    const generated = actualClaimsByTriple.get(claimTriple(claim));
    return generated !== undefined && claim.context_ids.some((contextId) => !generated.context_ids.includes(contextId));
  }).length;

  const priorById = new Map(episode.prior_memory.claims.map((claim) => [claim.id, claim]));
  const transitions = gold.claims.filter((claim) => priorById.has(claim.id));
  let correctTransitions = 0;
  for (const goldClaim of transitions) {
    const actualClaim = actualClaimsByTriple.get(claimTriple(goldClaim));
    if (actualClaim?.confidence_level === goldClaim.confidence_level) correctTransitions += 1;
  }

  const generatedClaimIds = new Set(actual.claims.map((claim) => claim.id));
  const expectedPromotion = new Set(episode.evaluation.promotion_expected_claim_ids);
  const forbiddenPromotion = new Set(episode.evaluation.promotion_forbidden_claim_ids);
  const expectedProduced = [...expectedPromotion].filter((id) => generatedClaimIds.has(id)).length;
  const forbiddenProduced = [...forbiddenPromotion].filter((id) => generatedClaimIds.has(id)).length;
  const promotionAttempts = expectedProduced + forbiddenProduced;

  return {
    admission: {
      ...admission,
      falseDurableKnowledge: admission.falsePositive,
      precisionWeightedForFalseDurability: admission.truePositive + admission.falsePositive === 0
        ? null
        : admission.truePositive / (admission.truePositive + 2 * admission.falsePositive),
    },
    concepts: setMetrics(
      new Set(gold.concepts.map((concept) => concept.id)),
      new Set(actual.concepts.map((concept) => concept.id)),
    ),
    duplicateConceptRate: actual.concepts.length === 0
      ? null
      : (actual.concepts.length - uniqueActualConceptIds.size) / actual.concepts.length,
    claimTriples: setMetrics(goldClaimTriples, actualClaimTriples),
    epistemicBasis: matchedClaimAccuracy(gold.claims, actualClaimsByTriple, (left, right) => left.epistemic_basis === right.epistemic_basis),
    confidenceTransition: accuracy(correctTransitions, transitions.length),
    evidence: setMetrics(
      new Set(gold.evidence.map((evidence) => evidence.id)),
      new Set(actual.evidence.map((evidence) => evidence.id)),
    ),
    evidenceLinks: setMetrics(evidenceLinkKeys(gold), evidenceLinkKeys(actual)),
    contexts: setMetrics(
      new Set(gold.contexts.map((item) => item.id)),
      new Set(actual.contexts.map((item) => item.id)),
    ),
    contextLinks: setMetrics(contextLinkKeys(gold), contextLinkKeys(actual)),
    overGeneralization: {
      scopedClaims: scopedGold.length,
      overGeneralizedClaims,
      rate: scopedGold.length === 0 ? null : overGeneralizedClaims / scopedGold.length,
    },
    temporalClassification: matchedClaimAccuracy(gold.claims, actualClaimsByTriple, (left, right) => left.lifecycle_status === right.lifecycle_status),
    validRange: matchedClaimAccuracy(gold.claims, actualClaimsByTriple, (left, right) => left.valid_from === right.valid_from && left.valid_to === right.valid_to),
    conflictRelations: setMetrics(
      relationKeys(gold, episode.prior_memory.claims),
      relationKeys(actual, episode.prior_memory.claims),
    ),
    promotion: {
      precision: promotionAttempts === 0 ? null : expectedProduced / promotionAttempts,
      recall: expectedPromotion.size === 0 ? null : expectedProduced / expectedPromotion.size,
      falseGeneralizationRate: forbiddenPromotion.size === 0 ? null : forbiddenProduced / forbiddenPromotion.size,
      expected: expectedPromotion.size,
      forbidden: forbiddenPromotion.size,
      expectedProduced,
      forbiddenProduced,
    },
  };
}
