# m-24 cut-list — dumb-core vs heuristic layer (ARV-335)

Инвентаризация 52k LOC `src/` в рамке decision-9: что оставить как
детерминированное ядро (**KEEP-CORE**), что срезать как автономную эвристику
(**CUT**), что пересобрать под осознанный вызов агента (**RESHAPE**).

Метод: 6 параллельных агентов по кластерам (fixtures, severity, annotate,
generator, probe, ядро), читали реальный код. Ранжирование cut-list — по
рычагу: (объём × вклад в баг-стрим × изолированность/безопасность удаления).

---

## TIER 1 — резать первым (изолировано, прямой источник багов, low-risk)

| # | что режем | путь | LOC | почему | баг |
|---|---|---|---|---|---|
| 1 | seed/cascade auto-create engine | `cli/commands/bootstrap.ts` + `core/generator/create-body.ts` | 1001+92 | Живой POST-создаёт ресурсы, угадывает тела, каскадит parent→child. 1% успеха на Stripe. Единственный потребитель — `prepare-fixtures --seed/--cascade`; check/probe-слой от него НЕ зависит. | ARV-327/329 |
| 2 | probe-time positional slot-fill | `core/probe/path-discovery.ts` `idFromItem` L410-422 | (439) | id-first, name-blind → числовой id уезжает в `{owner}`. **Точное место обвала GitHub до 5%.** | ARV-334 |
| 2b | CLI-двойник того же бага | `cli/commands/discover.ts` auto-fill (`preferredFieldFromVar`/`pickFieldFromObject`, `?? "id"` fallback) L41-114 | (часть 1299) | Латентная копия ARV-334 в discover. | ARV-334 |
| 3 | autonomous FP-suppression | `core/anti-fp/**` (index/registry/types/bootstrap+rules) | 517 | `applyAntiFp` **гейтит эмиссию** находки («это paid-plan FP» — суждение агента). reason-строки правил сохранить как evidence-поле, не как гейт. | — |

**Итог Tier 1: ~2.1k LOC hard-cut, всё изолировано.**

---

## TIER 2 — срезать зашитое суждение (scoped: оставить stub сырого evidence)

| # | что режем | путь | почему |
|---|---|---|---|
| 4 | live-seed угадывание значений | `core/generator/data-factory.ts` (759, **scope не delete**) | placeholder-синтез для `generate` легитимен (агент ревьюит yaml); режется только скалярное угадывание под live-seed. Critical fan-in — не удалять, а сузить. |
| 5 | annotate seed-body guess-engine | `cli/commands/api/annotate/auto.ts` | 747 | `inferSeedBody` фабрикует тела из format/name-фолбэков (→ `zond-probe-<name>`), сам ранжирует confidence. 1% на Stripe, уже носит `unfillable`-маркеры капитуляции. |
| 6 | severity-лестницы в пробах | `core/probe/security/classify.ts` `classifyInner`, `mass-assignment/classify.ts` `finaliseSeverity`, `detectors.ts` name-regex | evidence (echo/header-reflection/body-diff) КЕЕР; схлопывание в `high/med/low/info` + name-regex FP (CRLF на name/description) — CUT. |
| 7 | severity зашит в checks | `core/checks/checks/status_code_conformance.ts:81 severityFor()` и др. | реальное сцепление severity — **не** в папке `severity/`, а хардкодом внутри проверок. Занулить до нейтрального severity + raw evidence. |

**Расцепление severity — ключевой инвариант m-24:** механика эмитит только
`evidence{}` + `response_summary.status` + `message` + `recommended_action`;
severity ставит агент. Все находки эти поля уже несут — расцепление ничего
не ломает.

---

## TIER 3 — reshape в agent-driven инструмент (оставить скелет, снять auto-ветку)

| что | путь | reshape |
|---|---|---|
| discover | `cli/commands/discover.ts` (1299) | оставить `--verify`/gap-report (детерминированный **report-missing**), срезать auto-fill |
| prepare-fixtures | `cli/commands/prepare-fixtures.ts` (174) | только single-pass verify; убрать routing `--seed/--cascade` |
| annotate harness | `annotate/index.ts` (1376) + `prompts.ts` + per-aspect zod-парсеры + `overlay.ts` | **уже наполовину под агента** («zond does NOT formulate prompts — agent's job»): dump spec-slice → агент пишет yaml → zond валидирует/мержит. Снять только `auto`-подкоманду. |
| suite-generator | `core/generator/suite-generator.ts` (1184) | детерминированный скелет КЕЕР; ~250-300 LOC встроенного угадывания сценариев (auth-pair, healthcheck-regex, capture-field) → агент решает сценарии, generator материализует |
| generate overwrite | `cli/commands/generate.ts` (562) | `--force` сейчас no-op, перезаписывает безусловно → **правки агента теряются**. Сделать merge/preserve. |
| severity calibrator | `core/severity/{calibrator,config,loader,matcher,probe-adapter}.ts` (792) | opt-in, no-op по умолчанию → оставить как явный инструмент; ИЛИ CUT, если severity целиком агенту (risk низкий, default pass-through) |
| resources-builder | `core/generator/resources-builder.ts` (837, **scope**) | types + `buildApiResourceMap` кормят stateful-checks (КЕЕР); FK-chain owner-guessing → annotation/agent-authored. Widest fan-in — сузить, не удалять. |
| learn-drift | `core/runner/learn-drift.ts` (294) | детект-эвиденс КЕЕР; авто-переписывание `expect.status` в yaml (`--learn-apply`) → агенту |
| diagnose hints | `core/diagnostics/failure-hints.ts`, `suggested-fixes.ts` | механический spine (counts + grouping + `by_recommended_action`) КЕЕР; `auth_hint`/`env_issue` (порог ≥80%→`fix_env`)/`agent_directive` prose → CUT |
| probe digests/regression/webhooks | `probe/**/digest.ts`, `regression.ts`, `webhooks-probe.ts` | evidence КЕЕР; re-key на raw outcome, снять «treat as P0»/severity-литералы |

---

## KEEP-CORE — детерминированное ядро (выживает целиком)

- **Send/run:** `runner/` (executor, http-client, send-request, rate-limiter, assertions), `run.ts`, `request.ts`
- **Validate:** `runner/schema-validator.ts` (Ajv), `checks/` движок (минус зашитый severity), `lint/`
- **Spec:** `parser/`, `spec/infer-schema` + `schema-from-runs` + `schema-overlay`, `refresh-api.ts` — вывод схемы из **наблюдённых** ответов (union, required=intersection), не угадывание
- **Store:** `db/`, `session.ts`, `db.ts` (retention ARV-266)
- **Diff:** `compareRuns()` `diagnostics/db-analysis.ts:602` — чистый set-diff, без эвристик
- **Coverage/report:** `coverage/`, `reporter/` (console/json/ndjson/junit/sarif), `output/`
- **Routing-контракт:** `classifier/recommended-action.ts` (240) — closed-enum table, контракт триажа агента (НЕ impact-судья)
- **Report-missing (детерминированный):** `generator/fixtures-builder.ts` (manifest = «вот vars, заполни»), `workspace/fixture-gaps.ts`, `workspace/manifest.ts` (sha-ledger), `setup-api.ts`, `cleanup.ts`, `parser/dynamic-values.ts`
- **Probe как raw-evidence:** оба оркестратора (send/baseline/attack/GET), `negative-probe.ts` (691), path-discovery (кроме `idFromItem`), state-safety (baseline/cleanup/orphan-tracker), harness/runner/registry
- **agent-friendly yaml:** `generator/serializer.ts` — уже эмитит плоский yaml с per-step `source:` provenance

---

## Карта на задачи m-24

- **ARV-336** (убрать discovery/seed/cascade): Tier 1 #1,#2,#2b + Tier 3 discover/prepare-fixtures reshape.
- **ARV-337** (убрать калибраторы/annotate-auto): Tier 1 #3 + Tier 2 #4-7 + Tier 3 calibrator/annotate/probe-digests.
- **ARV-338** (yaml + diff + сводка):
  - diff — **reuse** `zond db compare` (`compareRuns`); gap: только по статусу, нет field-level body/schema-diff.
  - сводка — **reshape** `zond db diagnose` (spine КЕЕР, снять hints).
  - yaml-хранение прогонов — **net-new gap**: прогоны в SQLite, наружу только JSON-envelope. Добавить `--report yaml` поверх существующих queries (`getRunDetail`/`getResultsByRunId`).
- Новое, не покрытое существующими задачами: **generate merge/preserve** (правки агента теряются при регенерации, `--force` no-op) и **field-level run-diff** — кандидаты в отдельные m-24 задачи.

## Оценка объёма

Эвристический слой ~5-6k LOC из 52k, **сконцентрирован и изолирован**:
чистый hard-cut Tier 1 (~2.1k) не задевает check/probe-слой; остальное —
scoped-сужение и reshape с низким риском. Ядро (send→validate→store→diff)
переживает перестройку почти нетронутым.
