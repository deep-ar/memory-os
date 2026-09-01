# Phase D/E boundary and implementation backlog

This document keeps unresolved qualitative and real-world work visible without
turning invented criteria into benchmark scores.

## Phase D: not yet deterministic

The following tracks are intentionally **not scored**:

- semantic quality and scope of generalized abstractions;
- rationale correctness, causal relevance and evidence grounding;
- whether multiple claims constitute useful know-how;
- cross-project source-of-truth promotion quality;
- transfer to genuinely novel problems;
- longitudinal human usefulness.

Before any of these produces a benchmark number, a separately versioned protocol
must define the candidate unit, rubric, gold authoring process, assessor identity,
adjudication process, disagreement handling and aggregation rule. Human or
LLM-as-judge output must remain raw assessment evidence until that protocol is
approved. No new production MemoryOS entity is justified by these benchmark needs.

## Phase E: adapters may be built, results may not yet be claimed

Each real-world track needs an approved manifest containing:

- immutable repository/environment snapshot and license/provenance;
- chronological task ordering and a future-information leakage policy;
- explicit experimental modes and state-reset strategy;
- deterministic validator or versioned human gold;
- secrets and network policy;
- cost/timeout budget;
- per-track completion and invalid-run criteria.

Candidate tracks remain:

1. continual SWE issue sequences;
2. mature real-repository histories;
3. terminal/DevOps incidents;
4. product/architecture histories;
5. real-project chronological replay;
6. cross-project invariant validation.

Until those manifests exist, the current external-agent stdio protocol and
in-memory workspace validator are reusable scaffolding, not Phase E evidence.

## Formal Kernel coverage still required

The current controlled Kernel profile measures exact/semantic/context retrieval
and project isolation. Completion still requires dedicated datasets and runners
for graph paths, temporal state, conflict candidates, worktree identity,
concurrent writes, immutable-event replay, index rebuild, schema migration and
1K/10K/100K scalability profiles. These must be implemented before the full
benchmark can be described as complete.
