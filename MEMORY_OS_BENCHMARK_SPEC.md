# MemoryOS-Bench — Техническое задание на систему тестирования Memory OS

**Version:** 1.0  
**Status:** Target benchmark specification  
**Audience:** Codex / Claude Code / implementing agents  
**Purpose:** Development and validation of Memory OS  
**Primary principle:** measure whether accumulated experience reduces the cost of the next correct decision

---

# 0. Главная цель benchmark

MemoryOS-Bench должен проверять не то, **сколько информации система памяти способна сохранить**, а то:

> **Насколько с ростом накопленного опыта уменьшается стоимость следующего правильного решения без роста числа ошибок, ложных обобщений и вредного переноса старого опыта.**

Ключевая целевая зависимость:

```text
experience ↑
    ↓
repeated exploration ↓
repeated mistakes ↓
time to correct solution ↓
tool calls ↓
tokens ↓
unnecessary experiments ↓

while:

task correctness ↑ or stable
memory harm ↓ or stable
negative transfer ↓ or stable
stale knowledge usage ↓
```

Benchmark MUST отделять:

1. качество Memory Kernel;
2. качество memory curation агента;
3. способность агента использовать память;
4. end-to-end эффект памяти на инженерную деятельность.

Один агрегированный `Memory Score` НЕ является достаточным результатом benchmark.

---

# 1. Основные исследовательские вопросы

Benchmark должен давать формальный ответ как минимум на следующие вопросы.

## Q1. Retrieval

Может ли Memory OS найти нужное знание:
- точно;
- семантически;
- через graph relationships;
- с учетом времени;
- с учетом контекста;
- без утечки знания из других проектов?

## Q2. Curation

Может ли агент корректно определить:
- что стоит запоминать;
- что является шумом;
- какие Concept/Claim/Evidence нужно создать;
- какую epistemic basis присвоить;
- какой scope указать;
- какие старые знания надо уточнить;
- где есть противоречие;
- что следует supersede/invalidate;
- что следует сохранить как исторически валидное?

## Q3. Experience reuse

Может ли агент использовать прошлый опыт для новой задачи, а не просто воспроизвести старый факт?

## Q4. Efficiency gain

Снижает ли память:
- количество шагов;
- количество tool calls;
- количество shell commands;
- число прочитанных файлов;
- количество повторных экспериментов;
- token usage;
- wall-clock time;
- количество неверных подходов до правильного решения?

## Q5. Knowledge consolidation

Может ли система со временем аккумулировать:
- project-specific know-how;
- устойчивые engineering decisions;
- failed approaches;
- environment-specific gotchas;
- reusable patterns;
- cross-project invariants?

## Q6. Negative transfer

Не приводит ли память к ошибке при внешне похожей, но реально другой ситуации?

## Q7. Temporal evolution

Умеет ли система различать:
- что истинно сейчас;
- что было истинно раньше;
- что устарело;
- что было ошибочно;
- что зависит от версии или контекста?

---

# 2. Обязательное разделение ответственности

Benchmark MUST разделять минимум три независимых объекта оценки.

```text
A. MEMORY KERNEL
   storage
   graph
   indexing
   retrieval
   temporal filtering
   transactions
   project isolation

B. MEMORY CURATOR
   agent reflection
   admission
   epistemic labeling
   conflict reasoning
   promotion
   cleanup

C. INTEGRATED MEMORY AGENT
   actual software-engineering performance
```

Нельзя оценивать все три слоя одним end-to-end тестом.

---

# 3. Обязательные experimental modes

Любой integrated scenario MUST поддерживать как минимум четыре режима.

## MODE-0 — No Memory

```text
Agent
+
current repository/task/context
```

Память полностью отсутствует.

Назначение:
- baseline;
- определить способность агента решить задачу без прошлой памяти.

## MODE-1 — Oracle Memory

Агент получает заранее подготовленный **идеальный релевантный knowledge subgraph**.

```text
Agent
+
gold relevant memory
```

Memory backend не используется.

Назначение:
- измерить максимальную потенциальную пользу памяти;
- отделить способность агента использовать память от способности Memory OS ее найти.

## MODE-2 — Memory Backend + Oracle Writes

Историческая память создается только через заранее подготовленные gold `MemoryDelta`.

```text
Gold MemoryDelta
       ↓
Memory OS
       ↓
real retrieval
       ↓
Agent
```

Agent curation исключена.

Назначение:
- измерить чистое качество storage/retrieval;
- сравнить реальный retrieval с Oracle Memory.

## MODE-3 — Full Memory OS

```text
Agent reflections
       ↓
Memory OS
       ↓
retrieval
       ↓
Agent action
```

Полная система.

Назначение:
- реальная end-to-end оценка.

## MODE-4 — Flat RAG baseline

Обязательный контрольный baseline.

```text
old session summaries / notes
       ↓
chunks
       ↓
embeddings
       ↓
top-k
       ↓
Agent
```

Назначение:
- проверить, оправдывает ли epistemic temporal graph memory дополнительную сложность;
- исключить ситуацию, когда сложная Memory OS дает тот же результат, что простой vector store.

---

# 4. Диагностические gaps

Benchmark MUST рассчитывать минимум следующие величины.

## Potential Memory Gain

```text
OracleMemorySuccess - NoMemorySuccess
```

Показывает потенциальную пользу хорошей памяти для данного агента.

## Retrieval Gap

```text
OracleMemorySuccess - OracleWritesSuccess
```

Показывает потери на стороне Memory Kernel/retrieval.

## Curation Gap

```text
OracleWritesSuccess - FullMemorySuccess
```

Показывает потери из-за того, как агент формирует и обслуживает память.

## Memory Net Gain

```text
FullMemorySuccess - NoMemorySuccess
```

Конечная практическая польза системы.

---

# 5. Главная метрика эффективности

Для успешно решенных задач должна рассчитываться:

```text
CostOfCorrectResolution
```

Это не одно число, а вектор:

```yaml
CostOfCorrectResolution:
  agent_steps:
  tool_calls:
  shell_calls:
  file_reads:
  web_reads:
  tests_run:
  failed_attempts:
  tokens_in:
  tokens_out:
  wall_time:
```

При необходимости MAY рассчитываться нормализованный composite score, но исходные показатели MUST сохраняться отдельно.

Главная проверяемая гипотеза benchmark:

```text
E[CostOfCorrectResolution | accumulated experience N+1]
<
E[CostOfCorrectResolution | accumulated experience N]
```

для классов повторно используемого опыта.

---

# 6. Memory Harm

Обязательная метрика.

```text
Memory Harm =
task succeeds in No-Memory mode
but fails in Full-Memory mode
because retrieved/stored memory influenced the agent incorrectly
```

Рассчитывать:

```text
MemoryHarmRate =
HarmfulMemoryTasks / ComparableTasks
```

Также SHOULD классифицировать причины:

```text
stale memory
wrong claim
wrong context
false promotion
negative transfer
retrieval ranking error
agent misinterpretation
```

Memory Harm MUST рассматриваться как более серьезный дефект, чем пропущенное полезное воспоминание.

---

# 7. Positive и Negative Transfer

## Positive Transfer

Память помогает решить новую задачу за счет опыта из:
- прошлой задачи того же проекта;
- другого компонента;
- другого проекта.

## Negative Transfer

Память переносит опыт туда, где он неприменим.

Метрики:

```text
PositiveTransferRate
NegativeTransferRate
```

Для глобальных invariants `NegativeTransferRate` является критической метрикой.

---

# 8. Общая структура benchmark dataset

Один corpus SHOULD поддерживать все формальные tracks.

```text
bench/
├── projects/
│   ├── project-a/
│   ├── project-b/
│   └── ...
│
├── episodes/
│   ├── episode-001.yaml
│   ├── episode-002.yaml
│   └── ...
│
├── gold/
│   ├── concepts.yaml
│   ├── claims.yaml
│   ├── evidence.yaml
│   ├── contexts.yaml
│   ├── deltas/
│   └── graph-snapshots/
│
├── probes/
│   ├── retrieval/
│   ├── temporal/
│   ├── conflicts/
│   ├── promotion/
│   └── integrated/
│
└── harness/
```

---

# 9. Episode schema

Каждый episode представляет событие в жизненном цикле разработки.

```yaml
id: episode-017
project_id: editor-a

phase: implementation

timestamp: 2026-04-17T13:00:00Z

context:
  framework: React
  framework_version: "19"
  operating_system: Windows

input:
  task: >
    Investigate slow multi-object dragging.

observations:
  - type: benchmark
    data: ...

  - type: tool_result
    data: ...

  - type: code
    data: ...

gold_memory_delta:
  concepts: ...
  claims: ...
  evidence: ...
  contexts: ...
  conflicts: ...

future_dependencies:
  - probe-044
  - probe-079
```

---

# 10. Gold knowledge graph

Controlled benchmark MUST иметь explicit gold memory.

Gold MUST включать:

```text
Concepts
Claims
Evidence
Contexts
Claim relations
Temporal states
ReflectionEvents / MemoryDelta
```

Gold graph MUST быть создан независимо от tested Memory OS.

---

# 11. Принцип delayed reuse

Нельзя проверять память только сразу после записи.

Один significant knowledge item SHOULD использоваться повторно через разные интервалы:

```text
episode 10 -> knowledge created

episode 12 -> simple recall
episode 30 -> experience reuse
episode 60 -> similar context
episode 100 -> conflicting observation
episode 150 -> promotion opportunity
episode 200 -> historical lookup
```

Цель:
- тестировать долговременную память;
- не тестировать только краткосрочный cache.

---

# PHASE A — FORMAL / SELF-VERIFIABLE BENCHMARKS

Все тесты этой фазы MUST быть:
- deterministic или почти deterministic;
- автоматически запускаемыми агентом;
- не требовать человеческого LLM-judge для определения pass/fail;
- использовать заранее заданный gold.

Это первая обязательная фаза разработки benchmark harness.

---

# A1. Memory Kernel — Exact Retrieval

## Objective

Проверить нахождение конкретного Claim/Concept/Evidence.

Input:

```text
query
gold object ids
```

Metrics:

```text
Recall@1
Recall@5
Recall@10
MRR
nDCG
```

Pass/fail SHOULD опираться на object IDs, а не на текстовую similarity.

---

# A2. Semantic Retrieval

Gold Claim формулируется иначе, чем query.

Пример:

```text
memory:
"Updating React state on every pointermove creates excessive render churn."

query:
"Why does dragging many objects become slow?"
```

Проверять попадание gold Claim в ranking.

Metrics:

```text
Recall@k
MRR
nDCG
```

---

# A3. Exact Technical Retrieval

Специальные queries для:

```text
function names
environment variables
API names
error codes
exact configuration keys
```

Примеры:

```text
PASEO_ELECTRON_FLAGS
RECENT_DELIVERY_VALUE
builderOrderForLib
```

Задача проверяет full-text/lexical retrieval.

---

# A4. Multi-hop Graph Retrieval

Gold должен содержать path.

Пример:

```text
Paseo
  -> Electron
  -> ANGLE
  -> D3D
  -> blurry fonts
  -> use-angle=gl
```

Metrics:

```text
GoldNodeRecall
GoldEdgeRecall
GoldPathRecall
SubgraphPrecision
```

---

# A5. Temporal Retrieval

Сценарии MUST содержать:

```text
current fact
historical fact
superseded fact
invalidated fact
```

Queries:

```text
What is true now?
What was true at T?
What changed after T?
What was believed before commit X?
```

Metrics:

```text
TemporalStateAccuracy
ValidAtAccuracy
HistoricalRecall
SupersededFilteringAccuracy
```

---

# A6. Context-aware Retrieval

Gold содержит похожие Claims в разных Context.

Example:

```text
Claim A:
works on Windows + mixed-DPI

Claim B:
does not work on Linux + Wayland
```

Metrics:

```text
ContextMatchAccuracy
ContextRankingAccuracy
ContextLeakRate
```

---

# A7. Conflict Candidate Retrieval

Backend MUST find potential contradictory Claims but MUST NOT resolve them.

Input:

```text
new Claim candidate
```

Gold:

```text
list of conflict candidate IDs
```

Metrics:

```text
ConflictRecall
ConflictPrecision
ConflictF1
```

---

# A8. Project Isolation

Проекты имеют conflicting project-specific knowledge.

Пример:

```text
Project A -> pnpm
Project B -> npm
```

Search in B MUST NOT leak A unless explicit global search requested.

Critical metric:

```text
CrossProjectLeakRate
```

Target:

```text
0
```

---

# A9. Worktree Identity

Несколько worktrees одного проекта:

```text
main
WT-A
WT-B
WT-C
```

должны использовать один `project_id`.

Проверить:

```text
shared reads
shared writes
correct provenance
no accidental separate memories
```

---

# A10. Concurrent Writes

Генерировать concurrent `MemoryDelta`.

Проверить:

```text
no lost writes
no partial transactions
no corrupted graph
correct project revision
correct MEMORY_CONFLICT behavior
correct retry behavior
```

Тест MUST быть повторяемым многократно.

---

# A11. Event Replay

Procedure:

```text
1. apply N MemoryDelta
2. snapshot current graph
3. destroy derived graph state
4. replay immutable events
5. compare graph
```

Expected:

```text
semantic equivalence = exact
```

Object IDs и lifecycle state MUST совпадать либо иметь deterministic mapping.

---

# A12. Index Rebuild

Procedure:

```text
1. create data
2. delete embeddings/search indexes
3. rebuild
4. rerun retrieval suite
```

Expected:

```text
same canonical data
equivalent retrieval quality
```

---

# A13. Schema Migration

Иметь fixture старой schema version.

Проверить:

```text
migration
event preservation
graph correctness
retrieval correctness
```

---

# A14. Scalability

Gold graph sizes:

```text
1K Claims
10K Claims
100K Claims
optional 1M Claims
```

Measure:

```text
p50 search latency
p95 search latency
p99 search latency

apply_delta latency

RAM
disk
index size

Recall@k
```

Качество retrieval MUST измеряться одновременно с latency.

---

# PHASE B — FORMAL AGENT-CURATOR TESTS

Эти тесты используют AI agent, но Memory Kernel исключается из оценки.

Agent получает:

```text
complete episode
+
gold snapshot of existing memory
+
memory-reflection skill
```

и должен вернуть `MemoryDelta`.

Backend retrieval НЕ используется.

Цель:

> измерить способность агента курировать память независимо от качества storage/retrieval.

Большая часть этой фазы может быть оценена формально через gold.

---

# B1. Memory Admission

Episode содержит:

```text
routine facts
temporary facts
important findings
critical durable findings
```

Gold указывает, что должно быть сохранено.

Metrics:

```text
AdmissionPrecision
AdmissionRecall
AdmissionF1
```

Priority:

```text
Precision > Recall
```

False durable knowledge SHOULD иметь больший penalty, чем пропущенная второстепенная информация.

---

# B2. Concept Extraction

Agent должен выделить правильные Concept.

Metrics:

```text
ConceptPrecision
ConceptRecall
ConceptF1
DuplicateConceptRate
```

Для controlled dataset concepts SHOULD иметь canonical IDs.

---

# B3. Claim Decomposition

Agent должен преобразовать experience в правильный набор Claims.

Gold задает:

```text
subject
predicate
object
```

Metrics:

```text
ClaimTriplePrecision
ClaimTripleRecall
ClaimTripleF1
```

Text `statement` не является основным критерием.

---

# B4. Epistemic Basis Accuracy

Episode содержит явно различимые:

```text
hypothesis
tested result
external source
user decision
code-derived fact
agent observation
```

Metric:

```text
EpistemicBasisAccuracy
```

---

# B5. Confidence Transition

Gold задает ожидаемое изменение:

```text
tentative -> supported
supported -> verified
verified -> established
```

или отсутствие promotion.

Metric:

```text
ConfidenceTransitionAccuracy
```

---

# B6. Evidence Linking

Agent должен создать правильные Evidence и связи.

Metrics:

```text
EvidencePrecision
EvidenceRecall
EvidenceLinkF1
```

---

# B7. Context Extraction

Gold задает scope/context.

Metric:

```text
ContextPrecision
ContextRecall
ContextF1
```

Особый penalty:

```text
OverGeneralizationPenalty
```

если agent записал scoped fact как universal fact.

---

# B8. Temporal Classification

Gold задает:

```text
active
historical
superseded
invalidated
```

и valid time.

Metrics:

```text
TemporalClassificationAccuracy
ValidRangeAccuracy
```

---

# B9. Conflict Resolution

Controlled scenarios MUST включать пять типов:

```text
context split
temporal supersession
refinement
correction
unresolved contradiction
```

Metric:

```text
ConflictResolutionAccuracy
```

---

# B10. Promotion

Agent получает несколько related observations.

Некоторые scenario поддерживают generalized invariant.

Другие являются false-promotion traps.

Metrics:

```text
PromotionPrecision
PromotionRecall
FalseGeneralizationRate
```

Priority:

```text
PromotionPrecision >> PromotionRecall
```

Ложный invariant считается серьезной ошибкой.

---

# B11. Memory Cleanup

Initial memory содержит:

```text
duplicates
obsolete claims
overly broad claims
superseded claims
conflicts
```

Expected operations:

```text
merge
refine
supersede
invalidate
preserve historical
preserve disputed
```

Metric:

```text
CurationAccuracy
```

---

# B12. Source-of-Truth Promotion

Gold scenario задает knowledge, которое:

```text
should remain memory-only
```

или:

```text
should be promoted to docs/tests/rules/config
```

Metrics:

```text
SourceOfTruthPromotionPrecision
SourceOfTruthPromotionRecall
```

---

# PHASE C — CONTROLLED INTEGRATED SDLC BENCHMARK

Эта фаза проверяет agent + memory в полном цикле, но все еще использует controlled synthetic/semi-synthetic проекты с deterministic validation.

Часть evaluation формальна через:

```text
tests
repository state
deployment assertions
gold graph
known expected behaviors
```

---

# C1. Synthetic projects

Рекомендуется минимум четыре разных проекта.

Пример:

```text
Project A — React visual editor
Project B — backend SaaS/API
Project C — game runtime
Project D — deployment/infrastructure system
```

Каждый проект MUST проходить несколько SDLC стадий.

---

# C2. SDLC phases

Dataset SHOULD включать:

```text
product discovery
architecture
implementation
testing
deployment
operations
upgrade
support/maintenance
```

---

# C3. Product discovery scenarios

Knowledge:

```text
requirements
rejected product ideas
constraints
product invariants
user decisions
```

Future task SHOULD depend on old product knowledge.

---

# C4. Architecture scenarios

Agent рассматривает несколько вариантов.

History MUST содержать:

```text
alternatives
experiments
rejected approaches
selected architecture
rationale
```

Future extension task SHOULD reward reuse of architecture rationale.

---

# C5. Implementation scenarios

Include:

```text
bugs
failed approaches
performance investigations
framework gotchas
API behavior
reusable implementation patterns
```

Future tasks SHOULD include related-but-not-identical problems.

---

# C6. Testing scenarios

Include:

```text
regression causes
test design decisions
flaky tests
false assumptions
verified invariants
```

Memory SHOULD reduce repeated debugging.

---

# C7. Deployment scenarios

Include:

```text
Docker
reverse proxy
environment variables
migration
CI
networking
runtime configuration
```

Need environment-specific gotchas.

---

# C8. Incident scenarios

Example:

```text
incident 1
  hypothesis A
  failed fix A
  root cause B
  workaround C

later incident 2
  superficially similar
  partially shared cause
```

Test:

```text
reuse useful experience
without false transfer
```

---

# C9. Upgrade scenarios

Examples:

```text
framework upgrade
runtime upgrade
API v2 -> v3
database migration
```

Some old knowledge MUST become:

```text
historical
superseded
context/version limited
```

---

# C10. Cross-project learning

Controlled corpus MUST contain opportunities for global know-how.

Example pattern:

```text
Project A -> Strategy S helps
Project B -> Strategy S helps
Project C -> Strategy S helps
```

Gold MAY contain generalized invariant.

But benchmark MUST also include traps:

```text
Project A -> S helps
Project B -> S helps
Project C -> S fails under environment R
```

Expected:

```text
scoped generalized Claim
```

not:

```text
Always use S
```

---

# C11. Integrated metrics

Primary:

```text
TaskSuccessRate
TaskSuccessDelta
```

Efficiency:

```text
AgentSteps
ToolCalls
ShellCalls
FileReads
TestsRun
FailedAttempts
Tokens
WallTime
```

Memory-specific:

```text
RepeatedMistakeRate
PositiveTransferRate
NegativeTransferRate
MemoryHarmRate
StaleKnowledgeUsageRate
```

---

# C12. Repeated Mistake Rate

If an earlier episode established:

```text
Approach A fails because X
```

measure whether the agent tries A again in a later related task.

```text
RepeatedMistakeRate =
RepeatedKnownFailures / OpportunitiesToAvoidKnownFailures
```

This is a primary engineering-memory metric.

---

# C13. Exploration Reduction

Compare:

```text
No Memory
vs
Full Memory
```

for successfully solved comparable tasks.

Measure reduction in:

```text
tool calls
file reads
shell calls
failed experiments
tests
tokens
wall time
```

---

# C14. Learning curve

The benchmark MUST evaluate performance as experience accumulates.

For each reusable task family, build:

```text
episode index
vs
CostOfCorrectResolution
```

Expected useful memory:

```text
negative slope
```

while success stays stable/increases.

Metric examples:

```text
LearningCurveSlope
CostReduction@N
ExperienceReuseEfficiency
```

---

# PHASE D — REQUIRES ADDITIONAL FORMALIZATION

Tests in this phase MUST NOT be considered deterministic benchmark until gold definitions and evaluation rules are explicitly agreed.

The agent MAY implement harness scaffolding, but MUST NOT invent correctness criteria.

---

# D1. Semantic quality of abstractions

Question:

> Is a generalized engineering invariant actually good?

Example:

```text
"Transient high-frequency interaction state should avoid expensive declarative render cycles."
```

Requires formalization of:

```text
correct abstraction level
scope completeness
over-generalization
actionability
novelty
```

Potential evaluation:

```text
expert gold
multiple LLM judges
human adjudication
```

Not yet deterministic.

---

# D2. Rationale quality

Need formalize:

```text
what counts as sufficient rationale?
```

Possible dimensions:

```text
correctness
causal relevance
evidence grounding
absence of hallucinated rationale
future usefulness
```

---

# D3. Know-how quality

Project know-how is broader than individual Claims.

Need define:

```text
when several Claims form useful know-how?
```

Possible future representation:

```text
KnowledgePattern
Procedure
Playbook
Invariant
```

Do NOT add such entities to Memory OS only for benchmark convenience without separate design decision.

---

# D4. Promotion quality across projects

Need formalize:

```text
minimum independent evidence
required context diversity
acceptable generalization
required exceptions
```

Before this is defined, only controlled promotion fixtures are valid.

---

# D5. Novel problem transfer

Need distinguish:

```text
legitimate experience reuse
vs
agent solving task from pretrained knowledge
```

This is difficult and requires scenario design where relevant project experience materially changes the optimal action.

---

# D6. Human usefulness

Question:

> Does memory make an AI engineering collaborator feel more competent over months?

Requires longitudinal/user evaluation.

Not suitable as primary automated benchmark.

---

# PHASE E — REAL-WORLD VALIDATION

This phase requires separate scenario preparation, external repositories/environments and explicit validation rules.

The implementing agent SHOULD prepare adapters/harness architecture but MUST NOT silently substitute synthetic criteria.

---

# E1. Continual SWE benchmark

Goal:

Test whether experience across sequential issues in the same real repository improves later performance.

Candidate basis:

```text
SWE-Bench Verified
SWE-Bench continual/sequential variants
```

Requirements:
- preserve chronological ordering where possible;
- prevent future information leakage;
- maintain project memory across tasks;
- compare experimental modes.

Metrics:

```text
resolved issue rate
cost per resolved issue
repeated exploration
memory harm
```

---

# E2. Real repository long-running track

Select 3–5 mature repositories with:

```text
large history
multiple related issues
architecture evolution
version changes
regressions
```

Create chronological sequences.

Need formalize:

```text
which past issue knowledge should help which future issue
```

This dependency graph requires manual or semi-automatic curation.

---

# E3. Terminal / DevOps track

Realistic environments:

```text
Docker
nginx
database
network
CI
deployment
upgrade
incident response
```

Scenario structure:

```text
deploy
incident
fix
upgrade
related incident
```

Validation SHOULD use deterministic environment assertions where possible.

---

# E4. Product/architecture track

Hardest real-world track.

Input MAY include:

```text
product requirements
design docs
architecture discussions
ADR
implementation outcomes
later change requests
```

Need human-authored gold for:

```text
important decisions
rationale
constraints
supersessions
cross-phase dependencies
```

---

# E5. Real project replay

Potential highest-value benchmark.

Take an actual completed project history:

```text
requirements
commits
issues
tests
deployment incidents
decisions
```

Replay events chronologically.

At checkpoints ask the agent to perform future tasks without access to future history.

Compare:

```text
No Memory
Oracle Memory
Full Memory
```

This requires careful leakage control.

---

# E6. Cross-project invariant validation

Use several real projects.

Human/curated analysis defines candidate reusable invariants.

Benchmark asks whether Memory OS:

```text
discovers useful commonality
preserves scope
avoids cargo-cult generalization
```

This SHOULD be considered an advanced benchmark track.

---

# 12. LLM-as-judge policy

Deterministic evaluation MUST be preferred.

Use:

```text
IDs
graph structure
state transitions
timestamps
tests
repository assertions
environment assertions
```

instead of LLM judging whenever possible.

LLM judge MAY be used for:

```text
semantic equivalence
abstraction quality
rationale quality
know-how usefulness
```

If LLM judge is used:

```text
at least two independent judges SHOULD be supported
judge prompt MUST be versioned
judge model MUST be recorded
disagreements MUST be retained
```

A benchmark result MUST NOT hide judge dependence.

---

# 13. Agent isolation requirements

To distinguish agent capability from memory capability:

- model version MUST be fixed within a benchmark run;
- system prompt MUST be versioned;
- memory-reflection skill MUST be versioned;
- toolset MUST be fixed;
- temperature/reasoning settings SHOULD be fixed where supported;
- current repository/task context MUST be identical across comparative modes;
- random seeds SHOULD be fixed where meaningful.

Each benchmark result MUST record:

```yaml
agent:
  provider:
  model:
  version:
  reasoning_mode:
  prompt_version:
  memory_skill_version:

memory:
  service_version:
  schema_version:
  embedding_model:
  retrieval_config:
  reranker:
```

---

# 14. Repetition and statistical validity

Integrated agent runs are stochastic.

Each non-trivial integrated scenario SHOULD be repeated.

Recommended:

```text
minimum 3 runs
preferably 5+ for important comparisons
```

Report:

```text
mean
median
standard deviation
confidence interval where useful
```

Do not present one stochastic run as definitive benchmark performance.

---

# 15. Cost accounting

Every run SHOULD record:

```yaml
cost:
  input_tokens:
  output_tokens:
  cached_tokens:
  tool_calls:
  wall_time:
  api_cost:
  local_compute_time:
```

Memory infrastructure cost SHOULD be recorded separately:

```yaml
memory_cost:
  embedding_time:
  retrieval_time:
  storage_write_time:
  reranker_time:
  bytes_stored:
```

---

# 16. Benchmark report

Canonical report SHOULD be divided into sections.

Example:

```text
MemoryOS-Bench

KERNEL
--------------------------------
Exact Recall@5              0.98
Semantic Recall@5           0.92
Graph Path Recall           0.90
Temporal Accuracy           0.97
Context Accuracy            0.96
Conflict Recall             0.93
Cross-project leakage       0.00
p95 search latency          180 ms

CURATOR
--------------------------------
Admission Precision         0.94
Admission Recall            0.81
Epistemic Basis Accuracy    0.92
Evidence Link F1            0.88
Context F1                  0.90
Conflict Resolution         0.86
Promotion Precision         0.96
Promotion Recall            0.72
False Generalization        0.02

INTEGRATED
--------------------------------
No Memory Success           0.52
Oracle Memory Success       0.81
Oracle Writes Success       0.77
Full Memory Success         0.69
Flat RAG Success            0.61

Potential Memory Gain      +29 pp
Retrieval Gap               -4 pp
Curation Gap                -8 pp
Net Memory Gain            +17 pp

Repeated Mistakes          -58%
Tool Calls                 -21%
Tokens                     -16%
Wall Time                  -19%

Positive Transfer           0.31
Negative Transfer           0.03
Memory Harm Rate            0.01
```

---

# 17. Benchmark acceptance philosophy

There MUST NOT be one global pass/fail threshold for all metrics.

However, several properties SHOULD be treated as release blockers.

Examples:

```text
CrossProjectLeakRate > 0
transaction corruption
partial MemoryDelta application
event replay mismatch
unrecoverable index rebuild
significant MemoryHarm regression
large FalseGeneralization regression
```

---

# 18. Recommended initial controlled corpus

Target size:

```text
4 projects
50–75 episodes per project
~250 total episodes

~150 Concepts
~250 Claims
~300 Evidence

~40 temporal changes
~30 contradictions
~20 valid promotion opportunities
~20 false-promotion traps

300–500 probes
```

Coverage MUST include:

```text
product
architecture
implementation
testing
deployment
operations
upgrade/support
```

---

# 19. Benchmark construction rules

Controlled scenarios SHOULD obey:

1. Each important Claim has explicit gold identity.
2. Useful future dependencies are planned before scenario generation.
3. Some knowledge is intentionally irrelevant noise.
4. Some old knowledge becomes stale.
5. Some contradictions are only contextual.
6. Some contradictions are temporal.
7. Some old Claims are genuinely wrong.
8. Some cross-project similarities support promotion.
9. Some similarities are promotion traps.
10. Some tasks should be solvable without memory.
11. Some tasks should materially benefit from memory.
12. Some tasks should expose Memory Harm if stale knowledge is used.

---

# 20. Anti-cheating / leakage requirements

Benchmark MUST prevent:

```text
future episode leakage
future git history access
future tests exposing solution
gold graph access in non-oracle modes
hidden metadata revealing expected answer
cross-mode persistent memory contamination
```

Each run MUST start from an isolated benchmark state.

---

# 21. Development phases

The implementation agent SHOULD develop benchmark infrastructure in the following order.

## Development Phase 1 — Formal Kernel Harness

Implement:

```text
dataset loader
gold graph loader
MemoryDelta replay
retrieval probes
temporal probes
context probes
conflict probes
project isolation
concurrency
replay
index rebuild
scalability harness
metrics/report
```

No agent required.

Completion criterion:

All Phase A tests can be executed autonomously and produce deterministic reports.

## Development Phase 2 — Formal Curator Harness

Implement:

```text
episode fixtures
gold prior-memory snapshots
agent invocation adapter
MemoryDelta parser
gold-vs-generated comparison
admission metrics
claim metrics
epistemic metrics
evidence metrics
context metrics
conflict metrics
promotion metrics
```

Memory Service retrieval MUST be bypassed.

Completion criterion:

Agent memory-reflection behavior can be evaluated independently from Memory Kernel.

## Development Phase 3 — Controlled Integrated Harness

Implement:

```text
No Memory mode
Oracle Memory mode
Oracle Writes mode
Full Memory mode
Flat RAG baseline

task runner
repository/environment reset
cost accounting
tool-call accounting
success validator
learning-curve reports
Memory Harm classification
```

Completion criterion:

Controlled SDLC corpus can measure end-to-end memory utility.

## Development Phase 4 — Formalization Backlog

Do NOT invent final scoring rules.

Prepare interfaces for:

```text
abstraction quality
rationale quality
know-how quality
cross-project promotion quality
human usefulness
```

Document unresolved evaluation questions.

## Development Phase 5 — Real-world Tracks

Only after separate scenario/gold design.

Integrate:

```text
continual SWE tasks
real repository sequences
DevOps/terminal scenarios
product/architecture histories
real project replay
cross-project invariant evaluation
```

Completion criteria MUST be defined per track before results are treated as benchmark evidence.

---

# 22. Deliverables

Benchmark repository SHOULD contain:

```text
memoryos-bench/
├── README.md
├── BENCHMARK_SPEC.md
│
├── schema/
│   ├── episode.schema.*
│   ├── probe.schema.*
│   ├── gold.schema.*
│   └── result.schema.*
│
├── datasets/
│   └── core/
│
├── harness/
│   ├── kernel/
│   ├── curator/
│   ├── integrated/
│   └── realworld/
│
├── baselines/
│   ├── no-memory/
│   ├── oracle/
│   └── flat-rag/
│
├── metrics/
├── reports/
└── tests/
```

---

# 23. Required benchmark properties

The finished benchmark MUST be:

```text
reproducible
versioned
agent-aware
memory-backend-aware
temporal
multi-project
multi-session
multi-worktree capable
diagnostic
cost-aware
resistant to LLM-judge dependence
```

---

# 24. Primary success criterion for Memory OS

The main success criterion is NOT:

```text
"Memory remembers more."
```

It is:

> **As relevant project and cross-project experience accumulates, the agent reaches correct engineering decisions with less repeated exploration and fewer repeated mistakes, while Memory Harm, stale-knowledge usage and negative transfer remain low.**

Formally, for reusable task families:

```text
CorrectResolutionRate(N+1) >= CorrectResolutionRate(N)

and

CostOfCorrectResolution(N+1) < CostOfCorrectResolution(N)

while

MemoryHarmRate(N+1) <= acceptable threshold
NegativeTransferRate(N+1) <= acceptable threshold
FalseGeneralizationRate(N+1) <= acceptable threshold
```

This is the core hypothesis that MemoryOS-Bench exists to test.
