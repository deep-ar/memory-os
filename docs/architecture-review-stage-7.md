# Architecture review — stage 7

Date: 2026-08-30

Verdict: pass.

## Architecture summary

Operational policy remains outside agent memory semantics. Integrity, sensitive-data deletion, and
observability are application modules behind narrow ports. FalkorDB, Fastify, Prometheus rendering,
Compose scheduling, and stdout traces are replaceable adapters. Primary knowledge writes still have one
entry point (`apply_delta`); hard-delete is a deliberately separate administrative exception with its own
content-free audit model.

## Review scores

| Category | Score | Evidence |
|---|---:|---|
| Business alignment | 2 | recovery, diagnosis, project isolation, secret handling, and audit map directly to the specification |
| Cohesion | 2 | integrity, deletion, metrics, HTTP, backup, and storage each have one owner |
| Coupling | 2 | application modules depend on ports; adapters are wired only in the runtime composition root |
| Information hiding | 2 | Admin API exposes task commands/reports rather than arbitrary Cypher or graph CRUD |
| Replaceability | 2 | database, HTTP, scheduler, metrics format, and trace sink can change independently |
| Abstraction quality | 2 | no generic repository/event framework; the exceptional destructive command is explicit |
| Testability | 2 | unit, transport, architecture, real FalkorDB/Ollama, RDB validator, CLI, and browser evidence |
| Operational clarity | 2 | local binding, remote auth rule, confirmation token, retention, health, metrics, and failure exits are explicit |

## Findings fixed

- High: the Compose volume originally targeted `/data`, not FalkorDB's actual persistence directory. Data
  was backed up and migrated to `/var/lib/falkordb/data` without deleting the volume.
- High: Evidence accepted credential payloads. Strong secret signatures are now rejected before embeddings
  or persistence, while explicit redaction placeholders remain documentable.
- High: the specification required hard-delete without preserving the secret in audit. The new atomic
  Evidence deletion stores only an id digest and administrative metadata.
- Medium: parallel integration suites could crash FalkorDB while independently creating indexes. The
  supported integration command serializes files; production has one bootstrap owner.
- Medium: operations had counts but not epistemic lifecycle gauges or correlated apply traces. Both are now
  exposed without logging Evidence content.

## Accepted trade-offs

- TLS termination is not embedded. External access requires a strong Bearer token and is intended to sit
  behind an operator-managed TLS reverse proxy; the default Compose binding remains localhost-only.
- Database/index byte sizes and event-log replay are specification SHOULD items. RDB bytes are present in
  every backup manifest, while forward schema migration is implemented; replay tooling remains a future
  recovery enhancement.
- Hard-delete currently targets Evidence because it owns source payloads. Extending deletion to another
  entity requires an explicit dependency/audit policy rather than a generic graph delete endpoint.

## Acceptance evidence

- workspace typecheck, unit tests, and production builds;
- real FalkorDB plus native Ollama/BGE-M3: 26 files and 72 tests passed;
- schema migration, integrity corruption, concurrency, retrieval, secret rejection, auth, and hard-delete;
- automatic RDB snapshot: manifest bytes/hash matched and `redis-check-rdb` reported checksum OK;
- production `doctor` healthy and Chrome `WHY DO WE BELIEVE THIS?` E2E passed.
