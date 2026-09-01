# Controlled benchmark profile v0.1

This profile implements the deterministic beginning of Phase A from
`MEMORY_OS_BENCHMARK_SPEC.md`.

Included initially:

- A1 exact retrieval;
- A2 semantic retrieval;
- A3 exact technical retrieval;
- A6 context-aware retrieval;
- A8 project-isolation leakage observation;
- machine-readable Recall@1/5/10, MRR, nDCG@10, and forbidden-object leakage;
- sequential gold MemoryDelta setup through the public MemoryOS contract.

Recorded but not claimed complete:

- graph paths, temporal evolution, conflict candidates, worktree identity, repeated concurrency,
  replay, complete index rebuild, migration matrix, and scalability;
- all Curator, Integrated, Phase D, and Phase E tracks.

Run validity requirements:

- explicit dataset id/version and hash;
- explicit MemoryOS URL and logical project IDs;
- recorded MemoryOS readiness and embedding identity;
- no undeclared project is queried;
- no future fixture or gold result is passed to the tested backend;
- a failed setup or probe remains a failed report, never a missing data point.

The first profile intentionally has no global pass/fail threshold. It produces diagnostic measurements.

