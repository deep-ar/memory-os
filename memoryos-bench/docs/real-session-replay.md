# LucyCocos real-session replay pilot

## Scope and evidence label

This detachable track asks whether memory projected from earlier LucyCocos root
Codex sessions helps with decisions recorded in the latest root session. It is a
Phase E pilot, not benchmark evidence while checkpoint gold remains
`draft_agent_derived`.

The track changes no MemoryOS schema or persistence model. Raw sessions,
prepared bundles, retrieved context, agent output and reports remain owned by
`memoryos-bench`; generated artifacts are ignored by Git.

## Chronological split

- discover JSONL files whose `session_meta.payload.cwd` exactly resolves to the
  requested workspace;
- classify string-valued `source` metadata as root sessions and object-valued
  sources as subagent traces;
- select the latest root session named by the checkpoint spec as holdout;
- train only on completed root turns whose completion timestamp is before the
  holdout start timestamp;
- exclude aborted turns, empty completions, subagent traces and every turn at or
  after the cutoff;
- freeze source size/SHA-256 and a canonical hash of the completed holdout
  prefix in the generated bundle.

This prevents a root session that overlaps the holdout start from leaking a
later completion into memory.

## Memory projection

`completed-turn-leading-conclusion-v0.1` is deliberately deterministic. Each
eligible completed turn becomes one bounded claim plus one provenance evidence
record. The claim contains the bounded user task and bounded final conclusion;
the evidence contains a `codex-session://<session>#turn-<n>` source URI, commit,
branch, observation timestamp and content hash. Obvious credential forms are
redacted. Tool logs, reasoning items, images and raw subagent traces are never
stored.

This projection is a simple baseline, not a semantic Curator. Its limitations
are visible in the report instead of being hidden behind another LLM.

## Modules and dependency direction

| Module | Responsibility |
|---|---|
| `real-replay/model` | Bundle, split, checkpoint and mode invariants |
| `adapters/codex-session-reader` | Codex JSONL discovery and bounded-prefix reading |
| `real-replay/prepare-real-replay` | Pure chronological split, redaction and MemoryDelta projection |
| `adapters/memoryos-real-replay-context` | Isolated project seeding and public `memory.get_context` retrieval |
| `real-replay/run-real-replay` | Paired no-memory/full-memory execution and metrics |
| `real-replay/run-retrieval-audit` | Local retrieval evidence without an external agent |
| `cli` | Composition and explicit filesystem/network configuration |

Policy modules import neither MCP nor filesystem/process adapters. The paired
runner reuses the existing provider-neutral Integrated agent protocol and its
stateless Codex bridge.

## Safety boundaries

- the live adapter refuses an existing benchmark project;
- use the benchmark Compose file, whose FalkorDB data directory is tmpfs;
- no production volume is mounted or deleted;
- the local retrieval command sends no checkpoint content to an external agent;
- an external paired run requires explicit authorization because derived real
  session content is included in the request payload;
- formal scores require human approval of the checkpoint gold.

## Initial local corpus

The first prepared bundle found eight root sessions and 68 subagent traces. It
used seven earlier roots, excluded one completion at/after the cutoff, projected
431 claims with 431 provenance evidence records, applied three redactions and
prepared twelve holdout checkpoints. These values are observations in the
generated bundle, not hard-coded dataset assumptions.

The first retrieval audit exposed a FalkorDB full-text parser failure caused by
a Markdown-escaped `\_\_LucyTest` fragment. The production adapter now removes
tokens containing only underscores before composing the RediSearch union query.
The clean rerun loaded all 862 entities and completed all twelve retrievals.

## Commands

```powershell
node memoryos-bench/dist/cli.js real-replay-prepare `
  --sessions-root <CODEX_SESSIONS_ROOT> `
  --cwd <PROJECT_ROOT> `
  --checkpoint-spec <LOCAL_CHECKPOINT_SPEC> `
  --output memoryos-bench/artifacts/lucycocos-real-replay-v0.1-bundle.json

node memoryos-bench/dist/cli.js real-replay-retrieval `
  --bundle memoryos-bench/artifacts/lucycocos-real-replay-v0.1-bundle.json `
  --memoryos-url http://127.0.0.1:17310 `
  --output memoryos-bench/artifacts/lucycocos-real-replay-retrieval-v0.1-report.json
```

After checkpoint gold is reviewed and external transmission is explicitly
authorized, `real-replay-run` executes the same checkpoint/repetition pairs in
`no_memory` and `full_memory_os` modes.
