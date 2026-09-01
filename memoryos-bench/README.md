# MemoryOS-Bench

`memoryos-bench` is a detachable black-box benchmark. It owns its datasets, gold
labels and reports, and talks to MemoryOS only through the public project HTTP API
and MCP tools.

Build and test from the repository root:

```powershell
pnpm --filter @memoryos/bench typecheck
pnpm --filter @memoryos/bench test
pnpm --filter @memoryos/bench build
```

Start the isolated benchmark stand. Its FalkorDB state is held in a container
`tmpfs`, so it cannot mix with the production volume and disappears when the
stand is removed:

```powershell
pnpm --filter @memoryos/bench stand:up
```

Run the controlled Kernel profile against that stand:

```powershell
node memoryos-bench/dist/cli.js kernel `
  --dataset memoryos-bench/datasets/controlled-v0.1.json `
  --url http://127.0.0.1:17310 `
  --output memoryos-bench/artifacts/controlled-v0.1-report.json
```

The runner refuses an already registered benchmark project by default. Use
`--allow-existing-projects` only when the target state and expected revisions are
explicitly controlled by the caller.

Stop and remove the isolated containers after the run:

```powershell
pnpm --filter @memoryos/bench stand:down
```

## Formal Curator harness

The Curator track bypasses MemoryOS completely. It gives an agent the complete
episode and prior-memory snapshot, parses the returned `MemoryDelta`, and compares
it with independent gold state.

Run the deterministic evaluator calibration:

```powershell
node memoryos-bench/dist/cli.js curator `
  --dataset memoryos-bench/datasets/curator-controlled-v0.1.json `
  --responses memoryos-bench/replays/curator-oracle-v0.1.json `
  --output memoryos-bench/artifacts/curator-oracle-v0.1-report.json
```

Replay files calibrate the evaluator; they are not live-agent benchmark results.
The corpus includes admission, scope, epistemic-label, confidence-transition,
temporal, conflict-relation and false-promotion cases. A deliberately faulty
replay is provided in `replays/curator-faulty-v0.1.json`.

For Paseo, Codex, Claude or another orchestrator, use the provider-neutral stdio
adapter. The executable receives one `CuratorAgentRequest` JSON document on stdin
and must return this envelope on stdout:

```json
{
  "output": { "memory_delta": {} },
  "cost": {
    "input_tokens": 0,
    "output_tokens": 0,
    "cached_tokens": 0,
    "tool_calls": 0,
    "api_cost": 0
  }
}
```

Example invocation:

```powershell
node memoryos-bench/dist/cli.js curator `
  --dataset memoryos-bench/datasets/curator-controlled-v0.1.json `
  --agent-command paseo-memoryos-bench-adapter `
  --agent-provider paseo `
  --agent-model fixed-model-id `
  --agent-version fixed-version `
  --output memoryos-bench/artifacts/curator-paseo-report.json
```

Cleanup mutations and source-of-truth promotion remain reported capability gaps:
`MemoryDelta` v1 cannot represent those operations, so the harness does not invent
scores for them.

## Controlled Integrated harness

The Integrated track executes every scenario three times in five modes: No
Memory, Oracle Memory, Oracle Writes, Full Memory OS and Flat RAG. Repository
state is cloned in memory for each run; only allowlisted full-file replacements
are accepted, and JSON files are compared structurally. Evaluator-only stale
labels and validators are not sent to the agent.

Calibrate the runner and metric formulas without an external agent:

```powershell
node memoryos-bench/dist/cli.js integrated `
  --dataset memoryos-bench/datasets/integrated-controlled-v0.1.json `
  --responses memoryos-bench/replays/integrated-calibration-v0.1.json `
  --output memoryos-bench/artifacts/integrated-calibration-v0.1-report.json
```

To exercise real MemoryOS retrieval and a real BGE-M3 Flat-RAG baseline while
keeping agent behavior deterministic, start the isolated stand and select the
live context provider:

```powershell
node memoryos-bench/dist/cli.js integrated `
  --dataset memoryos-bench/datasets/integrated-controlled-v0.1.json `
  --responses memoryos-bench/replays/integrated-calibration-v0.1.json `
  --memory-provider live `
  --memoryos-url http://127.0.0.1:17310 `
  --ollama-url http://127.0.0.1:11434 `
  --ollama-model bge-m3 `
  --output memoryos-bench/artifacts/integrated-live-retrieval-calibration-v0.1-report.json
```

This is still a replay calibration. It measures real retrieval and records its
mean, p50, p95 and p99 latency, plus separately measured MemoryDelta preparation
time, but it does not measure live Curator or solver quality. Full Memory OS
currently uses fixture-curated writes.

The external-agent adapter receives one `IntegratedAgentRequest` JSON document
on stdin and returns `{ "output": <IntegratedAgentOutput> }`. Repeated adapter
arguments can use `--agent-arg=<value>`, including values beginning with `--`.
The supplied Codex bridge runs in an empty temporary directory with a read-only
sandbox and structured output:

```powershell
node memoryos-bench/dist/cli.js integrated `
  --dataset memoryos-bench/datasets/integrated-live-smoke-v0.1.json `
  --agent-command node `
  --agent-arg=memoryos-bench/dist/adapters/codex-integrated-bridge.js `
  --agent-arg=--model --agent-arg=gpt-5.4 `
  --agent-arg=--reasoning-effort --agent-arg=low `
  --agent-provider openai-codex `
  --agent-model gpt-5.4 `
  --agent-version codex-cli-0.150.1 `
  --reasoning-mode low `
  --output memoryos-bench/artifacts/integrated-codex-gpt54-live-smoke-v0.1-report.json
```

An external run sends the synthetic request payload to the selected provider and
therefore requires explicit authorization in managed environments.

## LucyCocos real-session replay pilot

Prepare a detachable chronological bundle from completed root Codex turns. The
latest root named by the checkpoint spec is the holdout; subagent traces,
aborted turns and completions at/after the holdout cutoff are excluded:

```powershell
node memoryos-bench/dist/cli.js real-replay-prepare `
  --sessions-root <CODEX_SESSIONS_ROOT> `
  --cwd <PROJECT_ROOT> `
  --checkpoint-spec <LOCAL_CHECKPOINT_SPEC> `
  --output memoryos-bench/artifacts/lucycocos-real-replay-v0.1-bundle.json
```

Run a local MemoryOS/Ollama retrieval audit without sending session-derived
content to an external agent:

```powershell
node memoryos-bench/dist/cli.js real-replay-retrieval `
  --bundle memoryos-bench/artifacts/lucycocos-real-replay-v0.1-bundle.json `
  --memoryos-url http://127.0.0.1:17310 `
  --output memoryos-bench/artifacts/lucycocos-real-replay-retrieval-v0.1-report.json
```

The paired `real-replay-run` uses only `no_memory` and `full_memory_os`. It sends
derived real-session tasks and retrieved claims to the selected external agent,
so it requires separate explicit authorization. Draft checkpoint gold produces
an `exploratory_completed` report and must be human-approved before formal Phase
E claims. See [the real-session replay design](docs/real-session-replay.md).

## Canonical report

Compose the three independently generated track reports without losing their
evidence labels or SHA-256 provenance:

```powershell
node memoryos-bench/dist/cli.js report `
  --kernel memoryos-bench/artifacts/controlled-v0.1-report.json `
  --curator memoryos-bench/artifacts/curator-oracle-v0.1-report.json `
  --integrated memoryos-bench/artifacts/integrated-calibration-v0.1-report.json `
  --output memoryos-bench/artifacts/combined-calibration-v0.1-report.json
```

Replay calibration, external-agent measurement and live-system measurement stay
separate. Phase D/E and unfinished Kernel work are recorded in
`docs/formalization-and-real-world-backlog.md`.
