# Architecture brief — stage 7 operations

Date: 2026-08-30

## Goal and invariants

Stage 7 makes long-lived local memory diagnosable and recoverable. Operators need evidence that primary graph data, immutable events, schema metadata, and project revisions agree before trusting a backup or upgrade.

The operations layer owns integrity validation, metrics/traces, scheduled backup, migration execution,
secret rejection, authenticated non-local deployment, and audited hard-delete. Integrity reads never
repair data implicitly or treat derived embeddings/indexes as the primary copy.

## Decomposition

| Module | Responsibility | Public API | Adapter |
|---|---|---|---|
| Integrity application | Classify invariant violations into a stable report | `checkIntegrity()` | none |
| Integrity store port | Collect storage facts needed by invariants | `inspectIntegrity()` | FalkorDB read-only queries |
| Operations HTTP | Guard and serialize operational reads | `GET /api/v1/integrity` | Fastify |
| CLI diagnostics | Present service/model/storage health | `memoryos doctor` | HTTP client |
| Sensitive-data application | Authorize an explicit Evidence deletion and construct a content-free tombstone | `hardDeleteEvidence()` | FalkorDB atomic delete/audit query |
| Observability | Measure tool outcomes and emit content-free operation traces | `OperationMetricRecorder`, `OperationTraceSink` | Prometheus text and structured stdout |
| Backup scheduler | Produce and retain checksummed RDB snapshots | daily loop | Compose sidecar |

Dependency direction is `CLI -> Admin HTTP -> integrity application -> integrity port <- FalkorDB adapter`. The domain and existing agent tools do not import operations code.

## Integrity checks

- primary schema metadata exists at the supported version;
- every Project/entity/event has schema version 1;
- Concept, Claim, Evidence, Context, and ReflectionEvent project ids resolve to a Project;
- Claim has exactly one in-project SUBJECT Concept;
- cross-project relationships do not connect isolated project entities;
- Project revision equals the number of immutable ReflectionEvents committed in that project.

Issues are counts and identifiers, not raw sensitive content. A degraded report never repairs or deletes data.

Hard-delete is intentionally limited to Evidence, the entity allowed to contain source payloads. The
request requires an exact confirmation phrase. The tombstone stores a SHA-256 digest of the Evidence id,
reason, actor, and timestamp; it stores neither the id nor any Evidence property. Deletion and audit creation
are one FalkorDB query.

## Test and replaceability strategy

- application classification test with an in-memory fact store;
- real FalkorDB healthy and deliberately-corrupted isolated graph tests;
- guarded HTTP contract test;
- CLI exit-code test;
- production `doctor` acceptance.
- real-container migration 0-to-1 and hard-delete/tombstone tests;
- isolated `redis-check-rdb` and SHA-256 verification of a sidecar snapshot;
- authentication, Host/Origin, secret-rejection, metrics, and structured-trace tests.

Replacing FalkorDB changes only the fact adapter and its integration tests. Replacing Fastify changes the route adapter. Integrity policy and issue codes remain stable.
