# Memory OS — Formal Specification

**Version:** 1.0  
**Status:** Target architecture / authoritative specification  
**Audience:** AI coding agents, architects, implementers  
**Primary use:** Codex / Claude Code / Paseo / Nimbalyst  
**Normative keywords:** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY

---

## 0. Purpose

Memory OS is a long-term shared engineering memory for AI coding agents.

The system MUST store **structured engineering knowledge**, not chat transcripts.

The central design principle is:

> **The AI agent owns cognition and memory curation. The Memory OS backend owns deterministic storage, indexing, retrieval, provenance, temporal history, concurrency and audit.**

The backend MUST NOT independently decide what is important, true, obsolete, contradicted or worth remembering by using a generative LLM.

---

# 1. Core principles

## MEM-001 — Agent-controlled memory

The agent MUST decide:

- what is worth remembering;
- which concepts are relevant;
- which claims should be created;
- whether new information supports, contradicts, refines or supersedes existing knowledge;
- whether a contradiction is real or caused by context/version/time differences;
- whether confidence should be promoted or reduced;
- whether a claim should be invalidated;
- whether stable knowledge should be promoted into project documentation, tests, rules or code.

The backend MUST only provide deterministic tools that make these decisions possible.

---

## MEM-002 — Structured knowledge, not transcript storage

The primary memory representation MUST be a graph of:

- `Project`
- `Concept`
- `Claim`
- `Evidence`
- `Context`
- `ReflectionEvent`
- optional `Source`
- optional `Task`
- optional `Session`

A memory is a **connected knowledge subgraph**, not a text chunk.

Raw transcripts MAY be referenced externally but MUST NOT be the canonical long-term memory format.

---

## MEM-003 — Claim is a first-class entity

A fact MUST NOT be represented only as a graph relationship.

Every meaningful assertion MUST be represented as a `Claim` object with:

- identity;
- subject;
- predicate;
- object;
- human-readable statement;
- epistemic basis;
- confidence;
- lifecycle state;
- temporal validity;
- context/scope;
- evidence;
- provenance;
- relations to other claims.

---

## MEM-004 — Evidence and provenance are mandatory

Every non-trivial Claim SHOULD have evidence.

For every Claim, the system MUST be able to answer:

> Why does memory believe this?

Evidence MUST be independently addressable and linked to the Claim.

---

## MEM-005 — Context is first-class

The system MUST NOT assume that a Claim is universally true.

Claims SHOULD specify the context/scope in which they apply.

Different results in different contexts MUST NOT automatically be treated as contradictions.

---

## MEM-006 — Bi-temporal knowledge

Memory MUST distinguish:

- **transaction time** — when the system learned/changed the knowledge;
- **valid time** — when the knowledge is considered true in the represented domain.

Historical truths MUST remain queryable after supersession.

---

## MEM-007 — History is immutable

The current knowledge graph MAY change.

The history of changes MUST NOT be overwritten.

Every meaningful memory change MUST be represented by an immutable `ReflectionEvent`.

---

## MEM-008 — No autonomous epistemic mutation

The backend MAY detect:

- similarity;
- possible duplicates;
- possible contradictions;
- possible promotion candidates;
- stale timestamps.

The backend MUST NOT autonomously:

- merge concepts;
- invalidate claims;
- supersede claims;
- promote confidence;
- rewrite statements;
- resolve contradictions.

Those operations require an agent-authored `MemoryDelta`.

---

## MEM-009 — Shared project memory

Memory MUST be shared by all agents working on the same logical project.

Physical working directory MUST NOT define project identity.

Git worktrees MUST map to the same canonical `project_id`.

---

## MEM-010 — Source of truth stays outside memory

Memory OS MUST NOT replace:

- source code;
- tests;
- CI;
- configuration;
- `AGENTS.md`;
- architecture documentation;
- schemas.

Stable claims SHOULD be promotable to those sources of truth.

Memory then preserves rationale, provenance and history.

---

# 2. High-level architecture

```text
                  Paseo / Nimbalyst
                         |
        +----------------+----------------+
        |                |                |
      Codex            Codex            Claude
        |                |                |
        +---------- memory-reflection ----+
                         |
                        MCP
                         |
                         v
                  MEMORY SERVICE
                         |
         +---------------+---------------+
         |               |               |
      Domain          Retrieval       Event Journal
       Model              |               |
         |        +-------+-------+       |
         |        |       |       |       |
         |      Vector FullText  Graph    |
         |        |       |       |       |
         +--------+-------+-------+-------+
                         |
                         v
                      FalkorDB
                         |
                   persistent storage

Derived infrastructure:

BGE-M3
  -> embeddings

Optional:
BGE multilingual reranker
```

---

# 3. Domain model

## 3.1 Project

A `Project` is the top-level memory isolation boundary.

```yaml
Project:
  id: string
  name: string
  description: string | null
  repository_uri: string | null
  created_at: datetime
  updated_at: datetime
  schema_version: integer
```

### Requirements

- `Project.id` MUST be stable.
- `Project.id` MUST NOT depend on `cwd`.
- Multiple worktrees MUST map to the same project.
- A Claim MUST belong to exactly one Project.
- Cross-project knowledge MAY be supported through an explicit global project/bank, never by accidental leakage.

---

## 3.2 Concept

A `Concept` represents an entity or idea known to memory.

Examples:

- `MixSlide`
- `React`
- `Lexical`
- `pointermove`
- `ANGLE`
- `Paseo`
- `Windows mixed-DPI`
- `Transient transform strategy`

```yaml
Concept:
  id: string
  project_id: string

  canonical_name: string
  description: string | null
  concept_type: string

  aliases:
    - string

  created_at: datetime
  updated_at: datetime

  embedding_model: string | null
  embedding_version: string | null

  schema_version: integer
```

### Requirements

- `canonical_name` MUST be human-readable.
- `aliases` SHOULD prevent duplicate concepts.
- `concept_type` MUST be extensible.
- The backend MAY return probable duplicates.
- Concept merging MUST require an agent-authored operation.

Typical concept types:

```text
Project
Component
Technology
Library
API
File
Symbol
Problem
Approach
Mechanism
Environment
Platform
Decision
Constraint
Artifact
Version
Runtime
```

---

# 4. Claim

`Claim` is the central knowledge primitive.

Conceptually:

```text
[Subject Concept]
       |
       v
    [Claim]
       |
       v
[Object Concept]
```

Example:

```text
Subject:
React state update on pointermove

Predicate:
CAUSES

Object:
Excessive rerendering
```

---

## 4.1 Claim schema

```yaml
Claim:
  id: string
  project_id: string

  subject_id: string
  predicate: string
  object_id: string | null

  statement: string

  epistemic_basis: enum
  confidence_level: enum
  lifecycle_status: enum

  valid_from: datetime | null
  valid_to: datetime | null

  created_at: datetime
  updated_at: datetime
  last_verified_at: datetime | null

  context_ids:
    - string

  evidence_ids:
    - string

  provenance:
    reflection_event_id: string
    agent_id: string | null
    agent_type: string | null
    session_id: string | null
    task_id: string | null
    workspace_id: string | null
    worktree_id: string | null
    branch: string | null
    commit: string | null

  schema_version: integer
  revision: integer
```

---

## 4.2 Predicate

Predicate MUST use a controlled vocabulary where practical.

Examples:

```text
USES
CAUSES
AVOIDS
DEPENDS_ON
REPLACES
FAILED_BECAUSE
SOLVES
SUPERSEDES
REFINES
CONSTRAINED_BY
OBSERVED_IN
SUPPORTED_BY
DERIVED_FROM
APPLIES_TO
```

The vocabulary MUST be extendable.

The implementation SHOULD prevent trivial spelling variants from becoming distinct predicates.

---

# 5. Epistemic model

## 5.1 Epistemic basis

`epistemic_basis` describes **why this Claim exists**.

Allowed values:

```text
hypothesis
inferred
observed
tested
source_reported
user_asserted
code_derived
decision
```

### `hypothesis`

An agent-generated assumption not yet sufficiently verified.

### `inferred`

A conclusion derived from other Claims.

An inferred Claim SHOULD link to source Claims through `DERIVED_FROM`.

### `observed`

A result directly observed during work.

### `tested`

A result confirmed by an explicit test, experiment, benchmark or reproducible procedure.

### `source_reported`

A source states this information.

This MUST NOT be interpreted as guaranteed truth.

### `user_asserted`

The user explicitly supplied this information.

### `code_derived`

The fact was directly established from current project code.

### `decision`

An engineering/product decision.

A decision is not necessarily an objective truth.

---

## 5.2 Confidence

Allowed values:

```text
tentative
supported
verified
established
```

### tentative

Weak support or initial hypothesis.

### supported

One or more meaningful pieces of evidence support the Claim.

### verified

The Claim was reproducibly tested or strongly independently confirmed.

### established

The Claim has repeatedly held across meaningful independent observations within its scope.

### Requirement

The system MUST NOT use a floating-point confidence number as the canonical representation of certainty.

A derived numeric score MAY be used for ranking.

---

## 5.3 Lifecycle status

Allowed values:

```text
active
disputed
superseded
invalidated
historical
```

### active

Currently accepted as applicable knowledge.

### disputed

There is unresolved contradictory evidence.

### superseded

A newer Claim replaces this Claim while preserving historical validity.

### invalidated

The Claim is considered incorrect.

### historical

The Claim is not current but remains relevant as historical knowledge.

---

# 6. Evidence

Evidence is a first-class entity.

```yaml
Evidence:
  id: string
  project_id: string

  type: enum
  summary: string
  content: string | null

  source_uri: string | null

  repo: string | null
  commit: string | null
  branch: string | null
  file: string | null
  symbol: string | null
  line_start: integer | null
  line_end: integer | null

  command: string | null
  result: string | null

  quote: string | null

  observed_at: datetime | null
  retrieved_at: datetime | null
  created_at: datetime

  content_hash: string | null

  schema_version: integer
```

Allowed `type` values:

```text
test
benchmark
experiment
code
web_source
documentation
user_statement
agent_observation
log
tool_result
```

---

## 6.1 Evidence requirements

- Evidence MUST be separately identifiable.
- Multiple Claims MAY reference the same Evidence.
- Quotes MUST live inside Evidence, not directly inside Claim.
- Full copies of external web pages SHOULD NOT be stored.
- Source URLs SHOULD be preserved when applicable.
- Code Evidence SHOULD preserve repository + commit + file + symbol where possible.
- Test Evidence SHOULD preserve command/procedure and result.
- Evidence SHOULD be hashable for deduplication.

---

# 7. Context

`Context` describes conditions under which knowledge applies.

```yaml
Context:
  id: string
  project_id: string

  name: string
  description: string | null

  dimensions:
    operating_system: string | null
    application: string | null
    runtime: string | null
    runtime_version: string | null
    framework: string | null
    framework_version: string | null
    platform: string | null
    environment: string | null

  concept_ids:
    - string

  created_at: datetime
  updated_at: datetime

  schema_version: integer
```

### Requirements

- Context MUST be reusable between Claims.
- Context dimensions MAY evolve.
- Concept references SHOULD be preferred over opaque strings where the concept is meaningful.
- Context differences MUST be considered before contradiction resolution.

---

# 8. Temporal model

Memory OS MUST implement bi-temporal semantics.

## 8.1 Transaction time

```text
created_at
updated_at
```

Represents when Memory OS learned or changed a record.

## 8.2 Valid time

```text
valid_from
valid_to
```

Represents when the Claim is considered valid in the represented domain.

Example:

```yaml
ClaimA:
  statement: "Codex uses model X"
  valid_from: 2026-05-01
  valid_to: 2026-08-10
  lifecycle_status: superseded
```

```yaml
ClaimB:
  statement: "Codex uses model Y"
  valid_from: 2026-08-10
  valid_to: null
  lifecycle_status: active
```

Claim A MUST remain queryable.

---

# 9. Claim relationships

Claims MUST support explicit relationships to other Claims.

Required relation semantics:

```text
SUPPORTS
CONTRADICTS
SUPERSEDES
REFINES
DERIVED_FROM
```

Conceptually:

```text
Claim A ---- SUPPORTS ----> Claim B
Claim C -- CONTRADICTS ---> Claim B
Claim D -- SUPERSEDES ----> Claim B
Claim E ---- REFINES -----> Claim B
```

These relations MUST have provenance through ReflectionEvent operations.

---

# 10. Promotion

Promotion is an agent-controlled epistemic operation.

Promotion MAY:

1. raise confidence:
   - tentative -> supported
   - supported -> verified
   - verified -> established

2. create a more general Claim supported by several narrower Claims.

Example:

```text
Observation A:
Nimbalyst --use-angle=gl fixes blur.

Observation B:
Paseo --use-angle=gl fixes blur.

Observation C:
Cocos --use-angle=gl fixes blur.
```

Agent may create:

```text
Generalized Claim:
On the current Windows workstation,
Electron/Chromium applications using the default
D3D ANGLE path may exhibit blurry fonts under mixed-DPI.
```

with:

```text
A ---- SUPPORTS ---> Generalized Claim
B ---- SUPPORTS ---> Generalized Claim
C ---- SUPPORTS ---> Generalized Claim
```

### Requirements

- Promotion MUST be explicit.
- Promotion MUST preserve provenance.
- Backend MUST NOT auto-promote.
- `explain_claim()` MUST make promotion rationale inspectable.

---

# 11. Contradiction handling

Potential contradiction MUST trigger analysis, not automatic invalidation.

Possible resolutions:

## 11.1 Context split

```text
Claim A true in Context X
Claim B true in Context Y
```

Both remain active.

## 11.2 Temporal supersession

```text
Claim A was true before T
Claim B is true after T
```

Claim A becomes superseded/historical.

## 11.3 Refinement

Old Claim is too broad.

Example:

```text
Old:
Electron causes blurry fonts.
```

```text
Refined:
Electron + default D3D ANGLE + mixed-DPI
may cause blurry fonts.
```

## 11.4 Correction

Old Claim was wrong.

```text
old.lifecycle_status = invalidated
new --SUPERSEDES/CORRECTS--> old
```

## 11.5 Unresolved contradiction

Both Claims remain:

```text
lifecycle_status = disputed
```

and are connected via:

```text
CONTRADICTS
```

The agent MAY create an `OpenQuestion` Concept/Claim describing the unresolved issue.

---

# 12. ReflectionEvent

Every meaningful change to memory MUST occur inside an immutable `ReflectionEvent`.

```yaml
ReflectionEvent:
  id: string
  project_id: string

  agent_id: string | null
  agent_type: string | null

  session_id: string | null
  task_id: string | null
  workspace_id: string | null
  worktree_id: string | null

  branch: string | null
  commit: string | null

  trigger: enum

  created_at: datetime

  operations:
    - operation

  schema_version: integer
```

Allowed `trigger` values:

```text
task_complete
milestone
context_compaction
handoff
major_failure
major_discovery
user_correction
significant_test
session_end
manual
```

---

# 13. Event sourcing

Memory OS MUST maintain two logical layers:

```text
IMMUTABLE EVENT LOG
        |
        v
CURRENT KNOWLEDGE GRAPH
```

The event log answers:

> What happened to memory?

The knowledge graph answers:

> What does memory currently believe?

### Requirements

- Graph mutation MUST NOT bypass event recording.
- Events MUST be replayable.
- Derived indexes MUST be rebuildable.
- Schema migrations SHOULD be implementable by replay/migration.
- Administrative hard-delete MUST produce a tombstone/audit record that does not retain deleted sensitive content.

---

# 14. MemoryDelta

Agents MUST NOT normally mutate graph objects through many low-level CRUD calls.

The canonical write operation is:

```text
memory.apply_delta()
```

Schema:

```yaml
MemoryDelta:
  expected_revision: integer | null

  reflection_event:
    ...

  concepts:
    create: []
    update: []
    merge: []

  claims:
    create: []
    update: []
    refine: []
    promote: []
    supersede: []
    invalidate: []

  evidence:
    create: []

  contexts:
    create: []
    update: []

  conflicts:
    resolve: []
    mark_disputed: []

  source_of_truth_promotions: []
```

---

## 14.1 apply_delta transaction

The backend MUST:

1. validate schema;
2. validate project boundary;
3. validate referential integrity;
4. validate lifecycle transitions;
5. validate expected revision;
6. resolve temporary IDs;
7. begin transaction;
8. write ReflectionEvent;
9. apply graph changes;
10. generate/update embeddings;
11. update indexes;
12. commit transaction;
13. return applied IDs and new revision.

Partial application MUST NOT occur.

---

# 15. Optimistic concurrency

Multiple agents MAY write concurrently.

Each Project SHOULD maintain a monotonically increasing memory revision.

Example:

```text
project_revision = 192
```

An agent MAY submit:

```yaml
expected_revision: 192
```

If the memory changed before commit, backend MUST return:

```yaml
error:
  code: MEMORY_CONFLICT
  expected_revision: 192
  actual_revision: 194
  changed_objects:
    - ...
```

The agent SHOULD re-read affected memory and perform reflection again.

---

# 16. Memory reflection workflow

Memory OS MUST NOT automatically summarize every transcript.

Agents SHOULD execute a version-controlled `memory-reflection` skill at meaningful checkpoints.

Triggers SHOULD include:

```text
task complete
major milestone
context compaction
handoff
major failed approach
major discovery
user correction
significant test
session end
```

Workflow:

```text
Current work
    |
    v
Reflection trigger
    |
    v
Search related memory
    |
    v
Compare new findings to existing Claims
    |
    v
Analyze conflicts/context/time
    |
    v
Construct MemoryDelta
    |
    v
apply_delta()
```

---

# 17. Reflection skill requirements

The skill MUST instruct the agent to:

1. identify durable engineering knowledge;
2. ignore routine execution noise;
3. search existing concepts before creating new ones;
4. search related claims before creating new claims;
5. examine evidence;
6. examine temporal validity;
7. examine context differences;
8. resolve or explicitly preserve contradictions;
9. preserve failed approaches if they have future reuse value;
10. create/attach evidence;
11. propose promotion where appropriate;
12. propose source-of-truth promotion where appropriate;
13. submit one coherent MemoryDelta.

The skill MUST NOT instruct the agent to dump a session summary into memory.

---

# 18. Information that SHOULD be remembered

Examples:

- architectural decisions and rationale;
- failed approaches and why they failed;
- non-obvious bugs;
- reproducible workarounds;
- verified performance characteristics;
- environment-specific behavior;
- constraints;
- external facts relevant to decisions;
- hypotheses requiring future validation;
- user decisions/preferences directly relevant to the project;
- historical changes in project behavior;
- reusable engineering lessons.

---

# 19. Information that SHOULD NOT be remembered

Examples:

- every shell command;
- routine compiler errors;
- temporary task progress;
- simple file renames;
- trivial edits;
- information directly obvious from current code;
- complete transcripts;
- intermediate reasoning chatter;
- information only useful for the next immediate step;
- duplicated copies of CodeGraph data.

---

# 20. CodeGraph boundary

Memory OS and CodeGraph MUST have separate responsibilities.

## CodeGraph

```text
WHAT EXISTS NOW
```

Responsible for:

- files;
- symbols;
- dependencies;
- call graph;
- current code structure.

## Memory OS

```text
WHAT WE KNOW AND WHY
```

Responsible for:

- decisions;
- rationale;
- failed approaches;
- hypotheses;
- evidence;
- changes over time;
- context;
- engineering experience.

Memory MAY reference:

```text
repository
commit
file
symbol
```

but MUST NOT attempt to recreate the full code graph.

---

# 21. Source-of-truth promotion

A stable Claim SHOULD be promotable into a durable project artifact.

Possible targets:

```text
AGENTS.md
architecture documentation
test
CI rule
lint rule
configuration
schema
assertion
source code
```

Example:

```text
Memory Claim:
Transient pointer interaction state should remain outside React state.
```

may be promoted to:

```text
docs/architecture/editor-rendering.md
```

After promotion, memory SHOULD preserve:

- the rationale;
- evidence;
- history;
- link/path to source-of-truth artifact.

---

# 22. Retrieval architecture

Retrieval MUST be hybrid.

Required channels:

```text
semantic vector search
full-text search
graph traversal
temporal filtering
```

Recommended flow:

```text
                 QUERY
                   |
        +----------+----------+
        |          |          |
     semantic   full-text    graph
        |          |          |
        +----------+----------+
                   |
             temporal filter
                   |
                   v
                 fusion
                   |
                   v
             ranked subgraph
```

Reciprocal Rank Fusion (RRF) SHOULD be the default deterministic fusion algorithm.

---

# 23. Graph-oriented retrieval

Vector/full-text retrieval SHOULD identify graph entry points.

The final retrieval result SHOULD be a connected subgraph, not a flat chunk list.

Example:

```text
Query:
"font rendering problems in Electron"
```

Possible result:

```text
Electron
 |- USES -> ANGLE
 |          |- BACKEND -> D3D11
 |          `- BACKEND -> OpenGL
 |
 |- ASSOCIATED_WITH -> blurry fonts
 |                    |- OBSERVED_IN -> Paseo
 |                    |- OBSERVED_IN -> Nimbalyst
 |                    `- OBSERVED_IN -> Cocos
 |
 `- WORKAROUND -> use-angle=gl
```

---

# 24. Epistemic-aware ranking

Default ranking SHOULD prefer:

```text
1. current + established
2. current + verified
3. current + supported
4. current + tentative
5. disputed
6. historical
7. superseded
8. invalidated
```

Search options MUST allow explicitly including:

```text
historical
superseded
disputed
invalidated
```

---

# 25. Context-aware ranking

Search MAY accept context:

```yaml
context:
  project: mixslide
  operating_system: windows
  application: paseo
  runtime: electron
```

Ranking SHOULD boost Claims with matching context.

Context mismatch MUST reduce ranking but SHOULD NOT necessarily hide the Claim.

---

# 26. Temporal retrieval

The system MUST support queries equivalent to:

```text
What was considered true at time T?

What changed after T?

Which claims were superseded during a period?

What did we know before commit X?

What was last verified recently?
```

Temporal queries MUST operate on valid time and transaction time where appropriate.

---

# 27. Concept resolution

API:

```text
memory.find_concepts(query)
```

Must search:

- canonical names;
- aliases;
- full-text;
- semantic embeddings.

Backend MAY return duplicate candidates.

Example:

```yaml
results:
  - concept_id: react
    score: ...
    reason: canonical_name
  - concept_id: react-js
    score: ...
    reason: semantic_similarity
```

Backend MUST NOT automatically merge them.

---

# 28. Claim similarity and conflict candidates

The backend MUST support finding:

```text
similar claims
same subject claims
same subject+predicate claims
same subject+object claims
potential contradiction candidates
```

Conflict candidate detection is retrieval, not epistemic resolution.

---

# 29. Explainability

API:

```text
memory.explain_claim(claim_id)
```

MUST return:

```yaml
claim:
  ...

epistemic_state:
  basis:
  confidence:
  lifecycle_status:

contexts:
  ...

supporting_evidence:
  ...

supporting_claims:
  ...

contradicting_claims:
  ...

superseded_claims:
  ...

provenance:
  ...

reflection_history:
  ...
```

The system MUST always be able to answer:

> Why do we believe this?

---

# 30. MCP contract

Agent-facing API SHOULD remain compact.

Canonical MCP tools:

```text
memory.search
memory.get_context
memory.find_concepts
memory.get_claim
memory.explain_claim
memory.find_conflicts
memory.apply_delta
memory.history
```

Low-level graph CRUD SHOULD NOT be exposed as the primary agent interface.

---

## 30.1 memory.search

Input:

```yaml
project_id: string
query: string

context: object | null

include:
  active: true
  disputed: false
  historical: false
  superseded: false
  invalidated: false

time:
  at: datetime | null
  from: datetime | null
  to: datetime | null

max_results: integer
graph_depth: integer
```

Output:

```yaml
query:
project_id:

entry_points:
  - concept/claim references

claims:
  - ranked claims

concepts:
  - related concepts

edges:
  - relevant graph relationships

ranking_metadata:
  ...
```

---

## 30.2 memory.get_context

Purpose:

Return a compact, agent-ready knowledge subgraph relevant to a task.

Input:

```yaml
project_id: string
task_description: string
current_context: object | null
token_budget: integer | null
```

Output SHOULD prioritize:

- current verified knowledge;
- relevant decisions;
- known failed approaches;
- unresolved hypotheses;
- active conflicts;
- relevant evidence summaries.

It MUST NOT blindly dump all memory.

---

## 30.3 memory.find_concepts

Input:

```yaml
project_id: string
query: string
limit: integer
```

Output:

```yaml
concepts:
  - id
    canonical_name
    aliases
    concept_type
    similarity
```

---

## 30.4 memory.get_claim

Input:

```yaml
project_id: string
claim_id: string
```

Output:

Full Claim object.

---

## 30.5 memory.explain_claim

See section 29.

---

## 30.6 memory.find_conflicts

Input:

```yaml
project_id: string

claim:
  subject_id:
  predicate:
  object_id:
  statement:
  context_ids:
  valid_from:
  valid_to:
```

Output:

```yaml
potential_conflicts:
  - claim_id
    similarity
    conflict_reason
    context_overlap
    temporal_overlap
    evidence_summary
```

Backend MUST NOT resolve the conflicts.

---

## 30.7 memory.apply_delta

Input:

```yaml
project_id: string
memory_delta: MemoryDelta
```

Output:

```yaml
status: applied
project_revision: integer

created:
  concepts: []
  claims: []
  evidence: []
  contexts: []

updated:
  concepts: []
  claims: []

reflection_event_id: string
```

Failure example:

```yaml
status: failed
error:
  code: MEMORY_CONFLICT
  message: ...
  actual_revision: integer
  changed_objects: []
```

---

## 30.8 memory.history

Input:

```yaml
project_id: string

entity_type: string | null
entity_id: string | null

from: datetime | null
to: datetime | null

limit: integer
```

Output:

Chronological immutable ReflectionEvents.

---

# 31. Infrastructure

## 31.1 Memory Service

Memory Service MUST provide:

- domain validation;
- transactions;
- event sourcing;
- retrieval;
- indexing coordination;
- MCP API;
- administrative API;
- observability.

The service MUST NOT require a generative LLM for core operation.

Implementation language is unspecified.

---

## 31.2 FalkorDB

Target primary storage: FalkorDB or equivalent property-graph database.

Required capabilities:

```text
property graph
OpenCypher-like querying
vector HNSW indexes
full-text indexes
range indexes
persistent storage
concurrent access
backup/restore
```

Canonical stored objects:

```text
Project
Concept
Claim
Evidence
Context
ReflectionEvent
Source (optional)
Task (optional)
Session (optional)
```

---

## 31.3 Embeddings

Embeddings are infrastructure, not cognition.

Recommended default:

```text
BAAI/bge-m3
```

Requirements:

- multilingual;
- appropriate for Russian + English + code terminology;
- model/version MUST be tracked;
- derived embeddings MUST be rebuildable.

Suggested embedding text:

### Concept

```text
canonical_name
aliases
description
concept_type
```

### Claim

```text
subject
predicate
object
statement
context summary
```

### Evidence

Only if semantic search is useful for the Evidence type.

---

## 31.4 Reranker

A multilingual cross-encoder MAY be used.

Example:

```text
BAAI/bge-reranker-v2-m3
```

Reranking MUST remain optional.

The system MUST remain operational with:

```text
semantic + full-text + graph + RRF
```

without reranker.

---

# 32. Storage mapping

Recommended graph representation:

```text
(:Project)

(:Concept)

(:Claim)

(:Evidence)

(:Context)

(:ReflectionEvent)
```

Core relationships:

```text
(:Project)-[:HAS_CONCEPT]->(:Concept)
(:Project)-[:HAS_CLAIM]->(:Claim)

(:Claim)-[:SUBJECT]->(:Concept)
(:Claim)-[:OBJECT]->(:Concept)

(:Claim)-[:SUPPORTED_BY]->(:Evidence)
(:Claim)-[:APPLIES_IN]->(:Context)

(:Claim)-[:SUPPORTS]->(:Claim)
(:Claim)-[:CONTRADICTS]->(:Claim)
(:Claim)-[:SUPERSEDES]->(:Claim)
(:Claim)-[:REFINES]->(:Claim)
(:Claim)-[:DERIVED_FROM]->(:Claim)

(:ReflectionEvent)-[:CREATED]->(...)
(:ReflectionEvent)-[:UPDATED]->(...)
(:ReflectionEvent)-[:INVALIDATED]->(...)
(:ReflectionEvent)-[:SUPERSEDED]->(...)
```

The exact physical schema MAY differ if all semantic invariants remain intact.

---

# 33. Indexing

Indexes SHOULD include:

## Concept

```text
project_id
canonical_name
aliases
concept_type
embedding
```

## Claim

```text
project_id
predicate
epistemic_basis
confidence_level
lifecycle_status
valid_from
valid_to
created_at
updated_at
embedding
statement full-text
```

## Evidence

```text
project_id
type
source_uri
commit
file
observed_at
content_hash
```

## ReflectionEvent

```text
project_id
agent_id
session_id
task_id
branch
commit
trigger
created_at
```

---

# 34. Backup and restore

Memory is a long-lived project asset.

The infrastructure MUST provide:

```text
persistent storage
automated backup
snapshot/export
restore
integrity validation
```

Backup MUST preserve primary data:

- graph;
- events;
- schema metadata.

Embeddings and indexes SHOULD be treated as derived and rebuildable.

---

# 35. Schema versioning

Every primary object MUST contain:

```text
schema_version
```

The system MUST support schema migration.

Event log SHOULD allow:

```text
old events
   |
migration/replay
   |
new graph
```

---

# 36. Security

Default deployment MUST be local-only.

If network access is enabled:

- authentication MUST be required;
- TLS SHOULD be used;
- project isolation MUST be enforced;
- secret material MUST NOT be stored as normal Evidence.

The system MUST provide administrative hard-delete for sensitive information.

Hard-delete audit MUST NOT retain the secret content itself.

---

# 37. Observability

Metrics SHOULD include:

```text
project count
concept count
claim count
evidence count
reflection event count

active claims
disputed claims
superseded claims
invalidated claims

search latency
embedding latency
graph traversal latency
apply_delta latency

apply_delta success/failure
optimistic concurrency conflicts

database size
index size
```

Logs MUST identify:

```text
project
agent
session
reflection event
operation
failure reason
```

without leaking secrets unnecessarily.

---

# 38. Administrative UI

A web UI SHOULD provide:

```text
graph browsing
concept search
claim search
evidence inspection
epistemic status inspection
temporal history
conflict inspection
reflection event history
provenance inspection
administrative invalidate/restore
export
```

A primary UI action SHOULD be:

```text
WHY DO WE BELIEVE THIS?
```

for any Claim.

---

# 39. System invariants

The implementation MUST preserve all of the following.

## INV-001

Agent owns cognition.

## INV-002

Backend MUST NOT independently change epistemic meaning.

## INV-003

Every Claim has provenance.

## INV-004

Context is preserved.

## INV-005

History is not overwritten.

## INV-006

Invalidation is not deletion.

## INV-007

Temporal validity is core data.

## INV-008

Search returns structured knowledge/subgraphs, not only chunks.

## INV-009

Multi-agent concurrency is a normal operating mode.

## INV-010

Worktree path does not define project identity.

## INV-011

Stable project truth belongs in code/tests/docs/configuration.

## INV-012

Derived search indexes are rebuildable.

## INV-013

Memory writes occur through atomic MemoryDelta transactions.

## INV-014

Concept merge requires explicit agent/admin decision.

## INV-015

Contradiction detection and contradiction resolution are separate operations.

---

# 40. Error model

Canonical error codes SHOULD include:

```text
INVALID_SCHEMA
PROJECT_NOT_FOUND
CONCEPT_NOT_FOUND
CLAIM_NOT_FOUND
EVIDENCE_NOT_FOUND
CONTEXT_NOT_FOUND

INVALID_REFERENCE
INVALID_STATE_TRANSITION
PROJECT_BOUNDARY_VIOLATION

MEMORY_CONFLICT
DUPLICATE_CONCEPT_CANDIDATE
DUPLICATE_CLAIM_CANDIDATE

INDEX_FAILURE
EMBEDDING_FAILURE
STORAGE_FAILURE
```

Errors MUST be machine-readable.

---

# 41. Non-goals

Memory OS is NOT:

- a chat archive;
- a transcript summarizer;
- an autonomous LLM memory agent;
- a replacement for CodeGraph;
- a replacement for Git;
- a replacement for documentation;
- a replacement for tests;
- a general-purpose vector database wrapper.

---

# 42. Target behavior

After months of work, a new agent session MUST be able to ask:

```text
What is currently believed about X?

Why?

Under which conditions?

What approaches were tried?

Which approaches failed and why?

Which claims are hypotheses?

Which claims are verified?

What used to be true but is now obsolete?

Are there contradictory observations?

Which decisions were made?

Why were those decisions made?

Where was the stable rule promoted into code/tests/docs?
```

The answer MUST be derived from structured Claims, Evidence, Context, temporal history and provenance.

---

# 43. Example memory lifecycle

## Step 1 — hypothesis

```yaml
Claim:
  statement: >
    The default Chromium D3D rendering path may cause
    blurry fonts in the current mixed-DPI Windows environment.

  epistemic_basis: hypothesis
  confidence_level: tentative
  lifecycle_status: active
```

## Step 2 — evidence

```yaml
Evidence:
  type: experiment
  summary: "--disable-gpu removes blur"
```

```yaml
Evidence:
  type: experiment
  summary: "--use-angle=gl removes blur"
```

Claim becomes:

```text
confidence_level = supported
```

## Step 3 — independent observations

Same behavior is reproduced in:

```text
Nimbalyst
Paseo
Cocos Dashboard
```

Agent reflection promotes the claim to:

```text
confidence_level = verified
```

and MAY create a generalized Claim.

## Step 4 — future contradiction

A later Electron version does not reproduce the behavior.

Agent examines:

```text
old Electron version
new Electron version
ANGLE backend
driver version
display configuration
```

Possible result:

```text
Old Claim remains historically valid.

New Claim:
Electron version >= X no longer reproduces the issue
under the same environment.

Old Claim:
valid_to = date/version transition
lifecycle_status = superseded
```

No knowledge is deleted.

---

# 44. Example reflection flow

```text
Task completed
     |
     v
Agent identifies durable finding
     |
     v
memory.find_concepts(...)
     |
     v
memory.search(...)
     |
     v
memory.find_conflicts(...)
     |
     v
Agent reasons about:
- existing claims
- contexts
- evidence
- time
- contradictions
     |
     v
Agent constructs MemoryDelta
     |
     v
memory.apply_delta(...)
     |
     v
Memory Service validates + commits
     |
     v
ReflectionEvent + graph update + indexes
```

---

# 45. Development guidance for coding agents

This specification is authoritative.

An implementing agent MUST NOT introduce automatic LLM-based extraction, summarization, contradiction resolution or epistemic mutation unless this specification is explicitly revised.

When implementation trade-offs appear:

1. preserve epistemic correctness over convenience;
2. preserve provenance over compression;
3. preserve history over destructive mutation;
4. preserve explicit agent decisions over backend heuristics;
5. preserve project isolation;
6. preserve atomicity;
7. keep retrieval infrastructure replaceable;
8. keep storage-specific details behind a domain/service boundary.

---

# 46. Definition of architectural correctness

An implementation is architecturally compliant only if all of the following are true:

- agents explicitly curate memory;
- the backend can run without a generative LLM;
- Claims are first-class objects;
- Claims have provenance;
- Evidence is independently stored;
- context is modeled;
- valid time and transaction time are distinct;
- superseded knowledge remains queryable;
- contradiction resolution is agent-driven;
- writes are atomic;
- concurrent worktrees share one project memory;
- event history is immutable;
- semantic/full-text/graph retrieval are available;
- derived indexes can be rebuilt;
- stable knowledge can be promoted to external project sources of truth.

---

# 47. Canonical concise architecture statement

> Memory OS is a shared, temporal, epistemic knowledge graph for AI coding agents.  
> Agents decide what to remember and how knowledge should change.  
> The backend stores Claims, Concepts, Evidence, Context and immutable ReflectionEvents; performs graph/full-text/vector/temporal retrieval; and guarantees provenance, atomicity, concurrency and historical traceability.  
> Stable truths are promoted out of memory into code, tests, documentation and project rules.
