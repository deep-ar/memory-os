# Memory OS

## Техническое задание на систему долговременной инженерной памяти для AI-агентов

## 1. Назначение системы

Memory OS — долговременная общая память для AI-агентов, работающих над программными проектами.

Система предназначена для совместного использования Codex, Claude Code и других coding agents, в том числе одновременно работающих:

* над одним проектом;
* в разных Git worktrees;
* в разных ветках;
* в разных сессиях;
* через orchestration-системы типа Paseo или Nimbalyst.

Memory OS должна сохранять не историю диалогов как таковую, а **структурированное инженерное знание**, сформированное агентом в процессе работы.

Ключевой объект памяти — не сообщение, цитата или summary, а **утверждение о мире проекта**, связанное:

* с понятиями;
* с другими утверждениями;
* с доказательствами;
* с контекстом применимости;
* со временем;
* с происхождением знания;
* с историей изменения уверенности и статуса.

Memory OS является **эпистемическим temporal knowledge graph**.

---

# 2. Основной архитектурный принцип

Система должна строго разделять две зоны ответственности.

### AI-агент отвечает за cognition

Именно агент:

* решает, что заслуживает долговременного запоминания;
* формулирует новые понятия и утверждения;
* анализирует существующую память;
* сопоставляет новое знание со старым;
* определяет противоречия;
* решает, является ли противоречие реальным или вызвано различием контекста;
* повышает или понижает уверенность;
* уточняет формулировки;
* инвалидирует ошибочную информацию;
* определяет temporal supersession;
* предлагает обобщения;
* решает, что нужно вынести из памяти в документацию, тесты или правила проекта.

### Memory backend отвечает за deterministic infrastructure

Memory backend:

* хранит знания;
* хранит граф связей;
* индексирует данные;
* выполняет semantic/full-text/graph search;
* обеспечивает temporal filtering;
* обеспечивает provenance;
* обеспечивает атомарные изменения;
* обеспечивает конкурентную работу нескольких агентов;
* сохраняет immutable audit history;
* обеспечивает backup/restore;
* предоставляет API/MCP-интерфейс.

Memory backend **не должен самостоятельно использовать генеративную LLM для принятия решений о содержании памяти**.

Backend может обнаружить потенциальное противоречие, похожее понятие или кандидата на promotion, но окончательное изменение epistemic state принимает агент.

---

# 3. Что считается воспоминанием

Воспоминание не является отдельной строкой или документом.

**Воспоминание — это связанный подграф знаний**, обычно включающий:

```text
Concept
   │
   ▼
 Claim
 / |  \
/  |   \
Context Evidence Related Claims
           │
           ▼
       Source / Quote
```

Например знание:

> В MixSlide обновление React state на каждом pointermove при трансформации нескольких объектов вызывает избыточные rerender; использование transient CSS transform до завершения interaction устраняет проблему.

должно быть представлено не одной текстовой записью, а набором связанных понятий и утверждений.

```text
[React state update on pointermove]
                 │
              CAUSES
                 │
                 ▼
      [Excessive rerendering]

[Transient CSS transform]
                 │
              AVOIDS
                 │
                 ▼
      [Excessive rerendering]
```

Каждая связь при этом должна быть представлена полноценным объектом Claim с собственным контекстом, provenance, evidence и temporal state.

---

# 4. Основные сущности

## 4.1. Project

Логический программный проект.

Project identity не должен зависеть от физического пути checkout/worktree.

Пример:

```text
project_id = mixslide
```

Все следующие директории должны относиться к одному проекту:

```text
C:\projects\mixslide

C:\...\worktrees\render-performance

C:\...\worktrees\lexical-refactor
```

Проект является верхней областью изоляции памяти.

---

## 4.2. Concept

Concept — понятие или сущность, о которой система что-либо знает.

Примеры:

```text
MixSlide
React
Lexical
pointermove
multi-object transform
ANGLE
D3D11
Paseo
Electron
Windows mixed-DPI
```

Concept должен иметь минимум:

```yaml
id:
canonical_name:
description:
aliases:
concept_type:
project_id:
created_at:
updated_at:
```

`concept_type` не должен быть жёстко привязан к закрытой ontology. Система должна позволять расширять типы.

Типичные типы:

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
```

Система должна поддерживать aliases и предотвращать бесконтрольное размножение Concept для одной сущности.

---

# 5. Claim — центральная единица знания

Claim — утверждение о связи понятий или о состоянии некоторого понятия.

Claim является **first-class entity**, а не просто property graph edge.

Пример:

```yaml
subject: react-pointermove-state
predicate: CAUSES
object: excessive-rerendering
```

Claim должен иметь собственный ID и отдельный lifecycle.

Минимальная структура:

```yaml
id:

project_id:

subject_id:
predicate:
object_id:

statement:

epistemic_basis:
epistemic_status:
confidence_level:

valid_from:
valid_to:

created_at:
updated_at:
last_verified_at:

scope:
context_ids:

evidence_ids:

supports:
contradicts:
supersedes:
refines:

provenance:
```

`statement` — человекочитаемое краткое описание смысла Claim.

Графовая структура `subject / predicate / object` является основным машинным представлением.

---

# 6. Epistemic basis — происхождение знания

Каждый Claim обязан явно указывать, **почему агент считает его достойным хранения**.

Минимальный набор:

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

### hypothesis

Предположение агента, ещё не подтверждённое проверкой.

### inferred

Логический вывод из других Claim.

Обязательно должен содержать связи `DERIVED_FROM`.

### observed

Непосредственное наблюдение во время выполнения работы.

### tested

Знание подтверждено конкретным тестом, экспериментом, benchmark или воспроизводимым действием.

### source_reported

Информация получена из документации, статьи, GitHub issue, внешнего сайта и т. п.

Это **не означает объективную истинность**. Это означает:

> такой источник утверждает X.

### user_asserted

Информацию сообщил пользователь.

### code_derived

Факт непосредственно установлен анализом текущего кода.

### decision

Инженерное решение.

Decision не является утверждением об объективной истине.

Например:

```text
Use FalkorDB as storage backend.
```

может быть `decision`, но не `tested truth`.

---

# 7. Epistemic status и confidence

Нужно разделять:

### epistemic basis

Откуда взялось знание.

### confidence level

Насколько оно подтверждено.

### lifecycle status

Является ли оно актуальным.

Рекомендуемый confidence lifecycle:

```text
tentative
supported
verified
established
```

### tentative

Есть гипотеза или одиночное слабое свидетельство.

### supported

Есть одно или несколько разумных подтверждений.

### verified

Есть воспроизводимая проверка или сильное независимое подтверждение.

### established

Знание неоднократно подтверждалось в различных независимых наблюдениях и считается устойчивым в заданном scope.

Lifecycle status:

```text
active
disputed
superseded
invalidated
historical
```

Числовой `confidence=0.83` не должен использоваться как основной способ представления уверенности.

Дополнительный вычисляемый score допустим только как вспомогательная ranking-метрика.

---

# 8. Evidence

Evidence — отдельная first-class сущность.

Claim не должен содержать доказательства только в виде текста внутри себя.

Пример:

```text
Claim
 ├── SUPPORTED_BY → Benchmark
 ├── SUPPORTED_BY → CodeQuote
 └── SUPPORTED_BY → TestResult
```

Типы Evidence:

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

Минимальная модель:

```yaml
id:
project_id:

type:
summary:
content:

source_uri:

repo:
commit:
branch:
file:
symbol:
line_range:

command:
result:

quote:

observed_at:
retrieved_at:
created_at:

hash:
```

---

# 9. Цитаты

Цитата не является самостоятельным воспоминанием.

Она должна быть частью Evidence.

Цитатой может быть:

* фрагмент исходного кода;
* строка логов;
* часть вывода теста;
* фрагмент документации;
* фрагмент внешней статьи;
* сообщение пользователя;
* важная часть результата другого агента.

Например:

```text
Claim:
Paseo supports passing Electron flags through
PASEO_ELECTRON_FLAGS.

    │
    ▼

Evidence:
type = code
repo = getpaseo/paseo
file = packages/desktop/src/main.ts
commit = ...
quote = ...
```

Для внешних источников должны сохраняться:

```text
URL
retrieved_at
source_date, если известна
короткая цитата
hash/идентификатор содержимого при необходимости
```

Нельзя превращать Memory OS в архив полных копий сайтов или исходников.

---

# 10. Context и scope

Контекст является first-class частью знания.

Система не должна считать:

```text
X causes Y
```

универсальным утверждением, если реально известно:

```text
X causes Y under context Z.
```

Context может содержать связи с Concept:

```text
OS = Windows
Application = Paseo
Runtime = Electron 41
GPU = RTX 3090
DisplayMode = mixed-DPI
```

Claim может иметь scope:

```yaml
project: mixslide
component: editor
platform: browser
framework: react
framework_version: 19
environment: production
```

Scope должен по возможности ссылаться на существующие Concept, а не быть произвольным набором строк.

При обнаружении противоречий различный context/scope обязан анализироваться прежде, чем один из Claim будет признан неправильным.

---

# 11. Temporal model

Memory OS должна поддерживать **bi-temporal knowledge**.

Для Claim необходимо различать:

### Transaction time

Когда система узнала или изменила знание:

```text
created_at
updated_at
```

### Valid time

Когда знание считалось истинным относительно предметной области:

```text
valid_from
valid_to
```

Пример:

```text
Claim A:
Codex uses model X

valid_from = 2026-05-01
valid_to   = 2026-08-10
```

после изменения:

```text
Claim B:
Codex uses model Y

valid_from = 2026-08-10
valid_to   = null
```

Claim A при этом не является ошибочным.

Он:

```text
historically valid
superseded
```

Удаление исторически верной информации недопустимо.

---

# 12. Promotion

Promotion — процесс повышения epistemic confidence или создания более общего знания на основании нескольких наблюдений.

Promotion не должен означать механическое:

```text
confidence += 0.1
```

Пример:

```text
Observation A:
Nimbalyst --use-angle=gl fixes font blur.

Observation B:
Paseo --use-angle=gl fixes font blur.

Observation C:
Cocos Dashboard --use-angle=gl fixes font blur.
```

После reflection агент может создать:

```text
Generalized Claim:

On the current Windows workstation,
Electron/Chromium applications using the default D3D ANGLE
path may exhibit blurry fonts in mixed-DPI configurations.
```

Связи:

```text
A ─┐
B ─┼── SUPPORTS → Generalized Claim
C ─┘
```

Promotion всегда должен сохранять provenance.

Должно быть возможно выяснить:

> почему этот Claim получил статус established?

---

# 13. Противоречия и инвалидация

Противоречие не должно автоматически приводить к удалению или invalidation.

При появлении потенциально конфликтующего Claim система должна предоставить агенту оба утверждения вместе с:

* контекстами;
* temporal ranges;
* evidence;
* provenance;
* confidence;
* источниками.

Agent reflection должен определить один из исходов.

### Context split

Оба Claim правильны в различных контекстах.

### Temporal supersession

Первый Claim был истинным раньше, второй является актуальным сейчас.

### Refinement

Старый Claim был слишком общим и должен быть заменён более точной формулировкой.

### Correction

Старый Claim был ошибочным.

Он получает:

```text
status = invalidated
```

и связь:

```text
SUPERSEDED_BY / CORRECTED_BY
```

### Unresolved contradiction

Доказательств недостаточно.

Оба Claim сохраняются:

```text
status = disputed
```

и связываются:

```text
CONTRADICTS
```

Дополнительно может быть создано:

```text
OpenQuestion
```

или Claim-гипотеза, описывающая возможную причину расхождения.

---

# 14. История не удаляется

Invalidation не означает физическое удаление Claim.

Система должна сохранять:

```text
что считалось истинным
когда
кем
почему
на основании чего
когда это перестало считаться истинным
почему
чем было заменено
```

Физическое удаление допускается только для:

* ошибочно записанных секретов;
* требований privacy/security;
* технической очистки corrupted data;
* явной административной операции.

---

# 15. Reflection Event

Любое осмысленное изменение памяти должно происходить в рамках `ReflectionEvent`.

ReflectionEvent является immutable.

Он описывает:

```yaml
id:

project_id:
agent_id:
agent_type:

session_id:
task_id:
workspace_id:
worktree_id:

branch:
commit:

trigger:

created_at:

operations:
```

Типичные trigger:

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

ReflectionEvent хранит список изменений:

```text
CREATE_CONCEPT
UPDATE_CONCEPT

CREATE_CLAIM
REFINE_CLAIM
PROMOTE_CLAIM
SUPERSEDE_CLAIM
INVALIDATE_CLAIM

CREATE_EVIDENCE

RESOLVE_CONFLICT
MARK_DISPUTED
```

---

# 16. Event sourcing

Memory OS должна иметь два логических слоя.

```text
IMMUTABLE EVENT LOG
        │
        ▼
CURRENT KNOWLEDGE GRAPH
```

Event log отвечает на вопрос:

> что происходило с памятью?

Knowledge graph отвечает:

> что память считает известным сейчас?

Это необходимо для:

* audit;
* debugging;
* rollback;
* восстановления;
* анализа ошибок агента;
* объяснения provenance;
* возможного replay после изменения схемы.

Изменения графа не должны происходить мимо event layer.

---

# 17. Memory Reflection workflow

Memory OS не должна автоматически перерабатывать весь transcript сессии.

Вместо этого coding agent должен периодически выполнять специальный `memory-reflection` skill.

Workflow:

```text
Current work
     │
     ▼
Reflection trigger
     │
     ▼
Search related memory
     │
     ▼
Compare current findings
with existing Claims
     │
     ▼
Analyze conflicts
     │
     ▼
MemoryDelta
     │
     ▼
Memory Service
```

Перед записью агент обязан выполнить поиск существующих:

* Concept;
* Claim;
* conflicts;
* related evidence.

Цель — не бесконечно append'ить новые записи, а **согласовывать новое знание с существующим knowledge graph**.

---

# 18. MemoryDelta

Агент не должен изменять graph последовательностью низкоуровневых вызовов.

Основной write primitive:

```text
apply_delta()
```

MemoryDelta должен позволять атомарно передать:

```yaml
reflection_event:

concepts:
  create:
  update:
  merge:

claims:
  create:
  update:
  refine:
  promote:
  supersede:
  invalidate:

evidence:
  create:

conflicts:
  resolve:
  mark_disputed:

contexts:
  create:
  update:

source_of_truth_promotions:
```

Backend обязан:

1. проверить schema;
2. проверить referential integrity;
3. разрешить ID;
4. выполнить transaction;
5. обновить graph;
6. создать embeddings;
7. обновить indexes;
8. записать immutable event;
9. вернуть результат операции.

Частично применённый MemoryDelta недопустим.

---

# 19. Source-of-truth promotion

Memory OS не является главным источником истины для вещей, которые могут быть формализованы в проекте.

Источниками истины остаются:

```text
source code
tests
CI
AGENTS.md
architecture documentation
configuration
schemas
```

Если некоторый Claim:

* устойчив;
* неоднократно подтверждался;
* регулярно используется;
* фактически стал правилом проекта,

агент должен иметь возможность предложить:

```text
PROMOTE_TO_PROJECT_SOURCE_OF_TRUTH
```

Например:

```text
Memory Claim:
Transient pointer interaction state should stay outside React state.
```

может стать:

```text
docs/architecture/editor-rendering.md
```

или:

```text
test
lint rule
assertion
AGENTS.md rule
```

После promotion Memory OS хранит:

* rationale;
* исторический контекст;
* evidence;
* ссылку на project source of truth.

---

# 20. Multi-agent модель

Память должна быть shared service.

```text
                    Project Memory
                          │
            ┌─────────────┼─────────────┐
            │             │             │
         Codex A       Codex B       Claude
          WT-A          WT-B          WT-C
```

Одновременные агенты должны безопасно читать и изменять одну память проекта.

Worktree path не является идентификатором проекта.

Каждый ReflectionEvent при этом обязан фиксировать:

```text
agent
session
task
workspace
worktree
branch
commit
```

Это позволяет различать контекст параллельной работы.

---

# 21. Concurrent writes

Backend должен обеспечивать transaction-safe конкурентные изменения.

Недопустима архитектура, в которой несколько агентов напрямую append'ят общий JSON/Markdown файл без locking.

Операции `apply_delta` должны быть атомарными.

При optimistic concurrency конфликте backend должен вернуть агенту:

```text
MEMORY_CONFLICT
```

вместе с изменившимися объектами.

Агент должен повторно выполнить reflection с актуальным состоянием.

---

# 22. Retrieval

Memory retrieval должен быть hybrid.

Минимальные независимые retrieval channels:

```text
semantic vector search
full-text search
graph traversal
temporal filtering
```

Общая схема:

```text
                 QUERY
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
     semantic   full-text    graph
        │          │          │
        └──────────┼──────────┘
                   │
             temporal filter
                   │
                   ▼
                 fusion
                   │
                   ▼
              ranked graph
```

Для fusion рекомендуется Reciprocal Rank Fusion или эквивалентный deterministic алгоритм.

Reranker может быть дополнительным этапом.

---

# 23. Graph-oriented retrieval

Semantic search должен использоваться прежде всего для нахождения **точек входа в graph**.

Пример:

```text
query:
font rendering problems in Electron
```

Semantic/full-text search находит:

```text
Electron
ANGLE
blurry fonts
```

После этого выполняется graph expansion:

```text
distance <= configurable depth
```

и агент получает связанный subgraph:

```text
Electron
 ├─ USES → ANGLE
 │          ├─ BACKEND → D3D11
 │          └─ BACKEND → OpenGL
 │
 ├─ ASSOCIATED_WITH → blurry fonts
 │                    ├─ OBSERVED_IN → Paseo
 │                    ├─ OBSERVED_IN → Nimbalyst
 │                    └─ OBSERVED_IN → Cocos
 │
 └─ WORKAROUND → use-angle=gl
```

Система должна возвращать не набор случайных текстовых chunks, а **релевантный knowledge subgraph**.

---

# 24. Epistemic-aware ranking

Поиск должен учитывать статус знания.

При прочих равных приоритет:

```text
current + established
current + verified
current + supported
current + tentative
disputed
historical
superseded
invalidated
```

Но агент должен иметь возможность явно запросить:

```text
include historical
include superseded
include disputed
```

Например для расследования старой проблемы historical knowledge может быть важнее current.

---

# 25. Context-aware retrieval

Search API должен принимать текущий context.

Например:

```yaml
project: mixslide
platform: windows
application: paseo
runtime: electron
```

Ranking должен повышать Claim с совпадающим scope.

Claim, относящийся к Linux, не должен исчезать полностью, но должен иметь низкий context match.

---

# 26. Temporal retrieval

Должны поддерживаться запросы:

```text
что считалось истинным на дату X?

что изменилось после даты X?

какие Claims были superseded за период?

что мы знали об этой проблеме до commit Y?
```

Temporal state является частью core model, а не дополнительным фильтром поверх обычного RAG.

---

# 27. Explainability

Для любого Claim должна существовать операция:

```text
explain_claim(claim_id)
```

Она должна возвращать:

```text
Claim

current epistemic state

contexts

supporting evidence

supporting claims

contradicting claims

superseded claims

source provenance

reflection events

history of modifications
```

Агент всегда должен иметь возможность ответить:

> почему память считает это известным?

---

# 28. Concept resolution

Перед созданием Concept агент или backend должен иметь возможность выполнять:

```text
find_concepts(query)
```

с использованием:

* canonical name;
* aliases;
* semantic similarity;
* full-text similarity.

Backend может рекомендовать:

```text
likely same concept
```

но merge должен инициироваться агентом.

Автоматическое объединение семантически похожих сущностей без подтверждения запрещено.

---

# 29. Claim similarity и conflict candidates

Перед созданием нового Claim backend должен уметь находить:

```text
similar claims
potential contradictions
same subject/predicate claims
same subject/object claims
```

Это является retrieval-функцией.

Backend не обязан сам определять истинность противоречия.

Он возвращает агенту кандидатов для reflection.

---

# 30. Memory service API

Внешний API должен быть небольшим и ориентированным на задачи агента, а не на прямой CRUD graph database.

Основные операции:

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

Дополнительные административные операции могут существовать отдельно.

Агенту не рекомендуется выдавать десятки низкоуровневых graph CRUD tools.

---

# 31. MCP

Основной agent-facing transport — MCP.

MCP server является stateless facade над Memory Service.

Проект должен определяться явно:

```text
project_id
```

или через отдельный endpoint/configuration.

Запрещено определять project identity только через текущий `cwd`.

Это критично для работы через Paseo/Nimbalyst и Git worktrees.

---

# 32. Reflection Skill

Intelligence системы находится не в backend, а в version-controlled skill.

Например:

```text
skills/
└── memory-reflection/
    └── SKILL.md
```

Skill должен инструктировать агента:

1. определить значимые результаты работы;
2. найти связанные Concepts и Claims;
3. изучить существующий epistemic state;
4. сопоставить новые evidence;
5. проанализировать apparent contradictions;
6. различить context difference, temporal change и реальную ошибку;
7. сформировать MemoryDelta;
8. предложить promotion устойчивых знаний;
9. не записывать routine implementation noise.

Изменяя skill, можно совершенствовать memory cognition без миграции backend.

---

# 33. Что не следует сохранять

Memory OS не должна превращаться в подробный execution log.

Не следует сохранять:

* каждую команду shell;
* каждую ошибку компилятора;
* промежуточные rename;
* routine edits;
* легко восстанавливаемую информацию из текущего кода;
* полные transcripts;
* temporary task state;
* информацию, полезную только для ближайшего шага;
* автоматически сгенерированные summaries без epistemic ценности.

В память должно попадать то, что обладает **future reuse value**.

---

# 34. Связь с CodeGraph

Memory OS не должна дублировать CodeGraph.

### CodeGraph отвечает:

```text
WHAT EXISTS NOW
```

* symbols;
* files;
* dependencies;
* call graph;
* current structure кода.

### Memory OS отвечает:

```text
WHAT WE KNOW AND WHY
```

* решения;
* rationale;
* failed approaches;
* hypotheses;
* подтверждённые наблюдения;
* внешние источники;
* изменения знания во времени;
* контекст;
* evidence.

Memory OS может ссылаться на:

```text
repo
commit
file
symbol
```

но не должна пытаться хранить полноценную копию code graph.

---

# 35. Инфраструктура

Целевая локальная инфраструктура:

```text
                AI agents
                    │
                   MCP
                    │
                    ▼
             Memory Service
                    │
        ┌───────────┼────────────┐
        │           │            │
        ▼           ▼            ▼
     Graph       Full-text      Vector
        │           │            │
        └───────────┼────────────┘
                    │
                 FalkorDB
```

---

# 36. FalkorDB

Основное persistent storage — FalkorDB либо другой совместимый property-graph backend с аналогичными возможностями.

Необходимые возможности:

```text
property graph
OpenCypher-like querying
vector indexes
full-text indexes
range indexes
transactions/concurrency
persistent storage
backup/restore
```

Graph database должна хранить:

```text
Projects
Concepts
Claims
Evidence
Contexts
ReflectionEvents
Sources
```

и связи между ними.

---

# 37. Embeddings

Embeddings генерируются backend-инфраструктурой, а не reasoning-agent.

Рекомендуемая multilingual модель:

```text
BAAI/bge-m3
```

или её актуальный эквивалент.

Embedding representation:

### Concept

```text
canonical name
aliases
description
type
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

Только содержательные Evidence, для которых semantic retrieval имеет смысл.

Embedding model является replaceable component.

Версия embedding model должна храниться рядом с индексом.

---

# 38. Reranking

Cross-encoder reranking является отдельным optional infrastructure component.

Предпочтительный класс моделей:

```text
BGE reranker multilingual
```

Reranker не должен быть обязательным для корректной работы системы.

Без него retrieval должен оставаться функциональным через:

```text
semantic
+
full-text
+
graph
+
RRF
```

---

# 39. Генеративная LLM не является частью Memory Service

Memory Service не должен зависеть от Ollama/OpenAI/Anthropic для core operations.

LLM находится на стороне агента.

```text
Codex / Claude
        │
       thinks
        │
MemoryDelta
        │
        ▼
Memory Service
```

Это важный architectural invariant.

Backend может иметь optional LLM-independent NLP utilities, но не должен самостоятельно менять смысл knowledge graph.

---

# 40. Persistent event log

Помимо graph representation должен существовать надёжный immutable event log.

Возможные реализации:

* отдельные append-only records в FalkorDB;
* отдельное transactional хранилище;
* отдельная journal таблица/структура.

Критично не конкретное технологическое решение, а возможность:

```text
audit
replay
restore
rollback
migration
```

---

# 41. Backup и восстановление

Память считается ценным долгоживущим проектным asset.

Обязательны:

```text
persistent Docker volume
automated backup
point-in-time or snapshot restore
export
integrity validation
```

Backup должен включать:

```text
graph data
event log
schema/version metadata
embedding/index metadata
```

Должен существовать способ полностью перестроить derived indexes из primary data.

Embeddings и search indexes не должны быть единственной копией информации.

---

# 42. Миграции схемы

Data model неизбежно будет эволюционировать.

Каждый объект и event должны иметь:

```text
schema_version
```

Migration layer должен позволять:

```text
old event log
        ↓
replay/migration
        ↓
new graph representation
```

Именно поэтому immutable events являются важнее оптимизированных search indexes.

---

# 43. Безопасность

Memory OS потенциально хранит:

* фрагменты proprietary кода;
* инженерные решения;
* URL;
* конфигурации;
* логи;
* пользовательские указания.

Поэтому:

* сервис по умолчанию работает локально;
* network exposure должен быть выключен по умолчанию;
* при удалённом доступе обязательна authentication;
* секреты и credentials нельзя сохранять как обычные Evidence;
* должна существовать возможность hard-delete чувствительной информации;
* audit должен фиксировать административное удаление без сохранения самого секрета.

---

# 44. Observability

Memory Service должен предоставлять метрики:

```text
Concept count
Claim count
Evidence count
ReflectionEvent count

active/disputed/superseded/invalidated claims

search latency
embedding latency
graph traversal latency

apply_delta success/failure
concurrency conflicts

index size
database size
```

Логи должны позволять понять:

```text
какой агент
когда
какой MemoryDelta
пытался применить
и почему операция не удалась
```

---

# 45. Административный интерфейс

Желателен web UI для инспекции памяти.

Он не является средством основного редактирования knowledge graph, но должен позволять:

```text
просматривать graph

искать Concepts и Claims

видеть Evidence

видеть epistemic state

видеть historical state

видеть conflicts

видеть Reflection Events

просматривать provenance

выполнять administrative invalidate/restore

экспортировать данные
```

Особенно важен экран:

```text
WHY DO WE BELIEVE THIS?
```

для любого Claim.

---

# 46. Основные системные инварианты

Система считается архитектурно корректной только при выполнении следующих правил.

### Агент владеет cognition

Backend не принимает epistemic решения самостоятельно.

### Claim имеет provenance

Нельзя получить утверждение без возможности понять его происхождение.

### Claim имеет context

Универсальность не предполагается автоматически.

### История не перезаписывается

Изменение знания создаёт новый historical state.

### Invalidation не означает delete

Неверное прошлое остаётся частью истории.

### Temporal state является core property

Время не является просто timestamp поля created_at.

### Search возвращает knowledge, а не chunks

Основной результат retrieval — связанный subgraph.

### Multi-agent concurrency является штатным режимом

Система не должна проектироваться исходя из единственного writer.

### Worktree не является project identity

Проект определяется логически.

### Source of truth находится вне памяти

Стабильные правила должны при необходимости становиться кодом, тестом или документацией.

### Derived indexes восстанавливаемы

Graph/event data является первичной; vectors/indexes являются производными.

---

# 47. Целевая архитектура

```text
                         PASEO / NIMBALYST
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
           Codex A           Codex B           Claude
              │                 │                 │
              │          memory-reflection        │
              └─────────────────┼─────────────────┘
                                │
                               MCP
                                │
                                ▼
                       MEMORY SERVICE
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
        Domain Model       Retrieval         Event Journal
              │                 │                 │
              │        ┌────────┼────────┐        │
              │        │        │        │        │
              │      Vector  Fulltext   Graph     │
              │        │        │        │        │
              └────────┴────────┼────────┴────────┘
                                │
                                ▼
                            FalkorDB
                                │
                           persistent
                             storage


External derived component:

BGE-M3
   │
   └── embeddings


Optional:

BGE multilingual reranker
```

---

# 48. Концептуальный результат

Memory OS должна позволить агенту через несколько месяцев начать новую сессию и восстановить не просто:

> «мы обсуждали X»

а:

```text
Что сейчас считается истинным по X?

На основании чего?

При каких условиях?

Какие подходы уже пробовали?

Что не сработало и почему?

Какие гипотезы ещё не доказаны?

Что раньше считалось истинным, но устарело?

Есть ли противоречивые наблюдения?

Какие решения были приняты?

Почему именно они были приняты?

Где соответствующее правило уже закреплено
в коде, тестах или документации?
```

Это и является главным назначением системы.

Memory OS — не архив разговоров и не автоматический summarizer.

Это **долговременная, проверяемая, контекстная и изменяющаяся во времени инженерная модель знаний, которой управляет сам AI-агент**.
