---
id: m-17
title: "agent-api-contracts"
---

## Description

Тематический архитектурный рефакторинг, поднятый из 15 раундов парного
ralph-loop'а (`/zond-fb-tester` ↔ `/zond-fb-fixer`). m-16 закрыл точечные
papercuts (~30 ARV-задач), m-15 ввёл `zond checks` как registry-движок,
но раунды 12-15 показали: zond упирается **не в недостаток фичей**, а в
**нестабильные контракты между слоями**, которые видит агент-потребитель.

Стратегическая рамка — vector-3 (agent-first): zond — это CLI-as-Library
для агента, проверяющего работу другого агента перед merge. Этот milestone
делает CLI-поверхность контрактно-стабильной для трёх главных потребителей:

- `zond audit` (макро one-shot, который должен «просто работать»);
- `probe *` family (security/MA/static — главный security-вход);
- JSON envelope + `--report json` (как агенты потребляют выходы).

В отличие от m-16 (постоянно пополняемый bucket мелких багов), m-17 —
**конечный архитектурный скоуп** с критическим путём и done-критерием.

## Источники

### Стратегия
- `strategy/vector-3-agent-first.md` §4-5 — JSON-readiness как замена MCP.
- `strategy/audit-and-consolidation.md` §4 — карта консолидации команд.

### Эмпирика (feedback-loop, раунды 12-15)
- **F1-13 (HIGH)**: `prepare-fixtures` discover молчаливо игнорирует 8 из 11 vars в `.env.yaml`. Coverage Resend упёрся в 46% и не сдвигается без ручного редактирования env.
- **F2-13**: `.env.yaml` после `zond add api` не sync с `{{var}}` в сгенерированных тестах.
- **F1-14 (HIGH)**: `prepare-fixtures --seed` POST'ит пустой body, ловит 422, сдаётся. Главный блок макро `audit`.
- **F2-14**: нет retry на network-class ошибки в discover.
- **F1-15 (MEDIUM)**: `probe security --dry-run` пихает 14 «would attack» в bucket `severity.skipped: 32` → CI false-OK.
- **F2-15 (MEDIUM)**: `probe mass-assignment` без `--dry-run`, у `probe security` есть. Probe-family не унифицирован.
- **F3-15**: `probe security --json` упаковывает markdown в `data.digest.stdout` как raw-строку. Нечитаем для агента.
- **F4-15**: декларированный контракт `--report json` (structured) vs `<cmd> --json` (envelope) probe-команды не соблюдают.
- **F1-12** (quirk про ARV-41): commit обещал warning, реализация делает silent-skip — расхождение от размазанной логики классификации.

### Накопленный долг (видно в коде m-15/m-16)
- `--api` fallback повторяется 5 раз (TASK-17, TASK-20, ARV-21, ARV-29, ARV-33).
- `--include/--exclude` имплементирован дважды (ARV-9 для checks, ARV-25 для run); ARV-9 AC#3 и AC#6 не закрыты — probe-семейство остаётся вне.
- `recommended_action` логика разбросана по `Issue`, `SecurityFinding`, `db diagnose` (TASK-294 пытался унифицировать, но ARV-11 и ARV-42 добавили новые ветки).
- `TASK-184` codify envelope policy → есть, но probe-команды его не соблюдают (F3-15).

## Цели майлстоуна

### A. Fixture pipeline — `.api-fixtures.yaml` как источник правды (manifest + env per decision-7)

Главный блок для агентов: без рабочей fixture-цепочки макро `zond audit`
обещает one-shot, но падает на первом нетривиальном API. Decision-7
закрепил разделение на **manifest** (`.api-fixtures.yaml`, auto-generated
read-only список того, что API нужно) и **values** (`.env.yaml`, user-edit
where to get). Сейчас разделение нарушено: discover ходит по `.env.yaml`
вместо manifest'а, generator вставляет `{{var}}` которых manifest не
предсказывает (resend: 14 в manifest, 18 в тестах). Цель блока —
вернуть manifest в роль единственного источника правды о **списке**.

1. **fixtures-builder сканирует не только path-params** (ARV-A): после
   `add api` manifest содержит каждую var, на которую generator реально
   будет ссылаться (path + parent-FK из request bodies + capture-chain
   inputs). Новый source `body-fk`. F2-13 (5 missing vars) закрывается
   по дизайну.
2. **prepare-fixtures итерируется по manifest, не по env** (ARV-B):
   таблица status — одна строка на manifest entry (`filled |
   failed:no-list-endpoint | failed:list-empty | failed:miss-network |
   skipped:already-set | skipped:not-required`). Ключи в env, которых
   нет в manifest, печатаются warning'ом «not in manifest, ignored».
   F1-13 (8 vars молчаливо игнорировались) закрывается.
3. **`--seed` использует spec-aware request body** (ARV-C): переиспользует
   `buildCreateRequestBody(spec, resource, knownFixtures)` из `zond
   generate` (smoke-create путь). Подставляет parent-FK из уже
   заполненных values в env. F1-14 закрывается.
4. **Network-retry в discover/seed** (ARV-D): 1 retry с back-off на
   network-class ошибки (не на HTTP-status). Stack-trace из `bun:fetch`
   не утекает в stdout. F2-14 закрывается.

### B. Probe family — типизированный контракт

`probe static`, `probe mass-assignment`, `probe security` (и любой будущий
класс) обязаны реализовывать единый TS-интерфейс, а не «соглашение». На
review-уровне сейчас расхождения копятся: ARV-9 AC#6 deferred, F2-15
mass-assignment без `--dry-run`, F3-15 probe security `--json` отдаёт
markdown-блоб.

5. **`Probe` interface + harness-validator** (ARV-E): TS-интерфейс
   гарантирует `--dry-run`, `--list-tags`, `--api`, `--tag`,
   `--include/--exclude`, `--json`, `--report json`, `--output`. Build-time
   проверка: каждая registered probe class имплементит все слоты.
6. **Dry-run output shape отдельный от run-shape** (ARV-F): для probe
   `--dry-run` envelope содержит `data.endpoints[]` с `planned[] |
   skipped[]` enum. Severity-bucket'ы (`HIGH/INCONCLUSIVE/LOW/OK/SKIPPED`)
   не применяются, потому что в dry-run ничего не классифицировано.
   F1-15 закрывается по дизайну.
7. **`probe * --report json` структурный** (ARV-G): каждая probe
   эмиттит `endpoints[{path, method, classes_planned, fields_planned,
   findings[], skip_reason}]`. Markdown digest идёт в `--output` или
   `--report markdown`, не в `data.digest.stdout`. F3-15/F4-15 закрываются.
8. **Унификация probe-семейства** (ARV-H): `probe mass-assignment`
   получает `--dry-run`, `--include/--exclude`, `--list-tags` через
   общий harness. Закрывает F2-15 + ARV-9 AC#6.

### C. Cross-cutting infrastructure

Удалить повторяющиеся паттерны до того, как они продолжат всплывать
в каждом следующем feedback-раунде.

9. **`withApiContext` middleware** (ARV-I): один decorator над
   `Command.action`, который резолвит `--api` через `arg → ZOND_API →
   .zond/current-api → throw`. Удаляет fallback из 5 мест (ARV-17/20/21/
   29/33 — каждое было отдельным коммитом).
10. **`core/selectors.ts` — единый `--include/--exclude`** (ARV-J):
    закрывает ARV-9 AC#3. Run / checks / generate / probe вызывают одну
    функцию, не имеют дубликатов.
11. **`run_kind` в DB schema** (ARV-K): колонка `regular | probe |
    check`, заполняется автоматически при записи run'а. Coverage по
    умолчанию фильтрует `run_kind != 'probe'` без warning'а; ARV-41
    silent-skip получает явное обоснование (закрывает F1-12 quirk).
12. **`core/classifier.ts` для recommended_action** (ARV-L): единый
    модуль, принимает `(run_kind, provenance, status, suite_path,
    finding_class)` → `RecommendedAction`. `db diagnose`,
    `lint-spec.Issue`, `probe security.Finding`,
    `mass-assignment.Finding`, `checks.Finding` — все вызывают его.
    Удаляет дубликаты ARV-11 / ARV-42 / TASK-294.

### D. Контракт-тесты (lock-in)

Чтобы регрессии не появлялись через 2 sprint'а:

13. **Build-time проверка envelope-compliance** (ARV-M): для каждой
    команды с `--json` снимок envelope валидируется по
    `docs/json-schema/<cmd>.schema.json`. Команда без schema или с
    нарушением schema → CI fail. `TASK-184` стал контрактом, не
    соглашением.
14. **Contract-test для `Probe` interface** (ARV-N): для каждой
    зарегистрированной probe class гонится smoke на mock-spec и
    проверяется shape `--dry-run --json`, `--report json`,
    `--list-tags --json`, `--help` (содержит обязательные флаги).
    F1-15/F2-15/F3-15 не возвращаются.

## Не покрывает

- `verify --since main` (vector-3 §6) — отдельный m-18: depend on
  стабильных контрактов из m-17.
- BOLA / RBAC / chain-coverage (vector-2 spринт B) — m-18+.
- Полный fuzz engine (json-schema-faker) — vector-2 этап 2.
- Skills auto-generation из CLI-манифеста — отдельный m-19 (нужен
  ergonomic CLI-manifest сначала). Внутри m-17 скиллы обновляются
  вручную там, где меняется контракт.

## Принципы

- **Контракт — это TS-тип или JSON Schema, не markdown.** Если
  контракт можно сломать без падения сборки — он не контракт.
- **Один консумер — один shape.** dry-run и run возвращают разные
  data-shapes, потому что они отвечают на разные вопросы. Не
  переиспользуем severity-bucket'ы там, где severity не определена.
- **`.api-fixtures.yaml` — единственный источник правды о списке
  переменных** (per decision-7). `.env.yaml` хранит только values.
  Generate / refresh-api расширяют manifest. Discover/seed заполняют
  values в env, но **читают список** только из manifest. Если возникает
  расхождение (var в env без manifest entry, или var в test без manifest
  entry) — это warning/error, не silent ignore.
- **Anti-FP first.** Каждая задача имеет fixture-test на feedback-finding,
  который её мотивировал. Если задача closed, но finding репродьюсится
  — задача re-opened.
- **Не трогать схему DB без миграции.** ARV-K (run_kind) — единственная
  schema-change в этом milestone'е, делается с up/down миграцией.

## Done-критерий

1. **Coverage Resend** (главный benchmark feedback-loop'а) поднимается
   с 46% (current) до ≥70% **без ручного редактирования `.env.yaml`** —
   доказывает работающий fixture pipeline.
2. **`zond audit --api <new-api>` на trash-target API** (любой
   незнакомый OpenAPI 3.x) проходит все 7 стадий без `severity:high`
   зацикленных finding'ов в feedback-loop'е раунда 1.
3. **`zond probe security --dry-run --json`** возвращает
   `data.endpoints[].planned` (не пихает в `severity.skipped`).
   `data.digest.stdout` отсутствует в envelope. Schema валидируется
   по `docs/json-schema/probe-security.schema.json`.
4. **`zond probe mass-assignment --dry-run`** работает (не выдаёт
   `unknown option`).
5. **`grep -rn "ZOND_API ?? currentApi" src/cli/commands/`** возвращает
   0 строк (всё съедено `withApiContext`).
6. **`grep -rn "import.*operation-filter\|buildSelector"` в src/**
   показывает один import-source на все CLI-команды.
7. **`bun test tests/contracts/`** — 100% green, contract-test'ы
   ARV-M / ARV-N стоят в CI.
8. **Verify-раунд `/zond-fb-tester` против resend** не находит
   возвращённых F1-13/F1-14/F1-15/F2-15/F3-15.

## Граф зависимостей

```
ARV-I (withApiContext) ──────┐
                              ├──→ ARV-A (generate→env)
ARV-J (selectors)            │      │
                              │      ├──→ ARV-B (discover-by-env)
ARV-K (run_kind + migration) │      │      │
                              │      │      ├──→ ARV-C (--seed body)
ARV-L (classifier)           │      │      │      │
                              │      │      │      └──→ ARV-D (retry)
                              │      │      │
                              │      │      └──→ resend coverage ≥70%
                              │      │
ARV-E (Probe interface) ─────┴──→ ARV-F (dry-run shape)
       │                                │
       ├──→ ARV-G (--report json)       │
       │                                │
       └──→ ARV-H (mass-assignment dry-run + selectors)
                                        │
ARV-M (envelope contract-tests) ────────┤
                                        │
ARV-N (Probe contract-tests) ───────────┘
```

**Критический путь** (для done-criterion #1, coverage benchmark):
ARV-A → ARV-B → ARV-C. Всё остальное параллелится.

**Критический путь** (для done-criterion #3, agent-readable probe JSON):
ARV-E → ARV-F → ARV-G → ARV-N.

## Соответствие блоков и task ID

| Блок | Задачи в backlog |
|---|---|
| A. Fixture pipeline (manifest + env) | ARV-45 (manifest builder), ARV-46 (discover by manifest), ARV-47 (--seed spec-body), ARV-48 (network retry) |
| B. Probe contract | ARV-49 (Probe interface), ARV-50 (dry-run shape), ARV-51 (--report json), ARV-52 (mass-assignment align) |
| C. Cross-cutting | ARV-53 (withApiContext), ARV-54 (selectors), ARV-55 (run_kind), ARV-56 (classifier) |
| D. Contract-tests | ARV-57 (envelope), ARV-58 (Probe interface) |

## Что закрывается из накопленного долга

- ARV-9 AC#3, AC#6 — деферренные wire `--include/--exclude` в probe и run (ARV-J + ARV-H).
- F1-12 (ARV-41 silent-skip vs warning) — становится оправданным дизайном через ARV-K.
- TASK-184 (codify envelope) — превращается в build-time контракт через ARV-M.
- TASK-294 (unify recommended_action) — закрывается ARV-L полностью; ARV-11 и ARV-42 становятся частными случаями classifier'а.
