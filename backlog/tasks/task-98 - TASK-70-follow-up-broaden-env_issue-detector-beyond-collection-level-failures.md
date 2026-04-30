---
id: TASK-98
title: >-
  TASK-70 follow-up: broaden env_issue detector beyond collection-level
  failures
status: To Do
assignee: []
created_date: '2026-04-30 15:00'
labels:
  - diagnose
  - follow-up
dependencies:
  - TASK-70
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

[TASK-70](task-70%20-%20T70-diagnose-—-env_issue-верхнего-уровня-противоречит-per-failure-recommended_action.md)
закрыл противоречие между run-level `env_issue` и per-failure
`recommended_action`: когда detector помечает run как env_issue, все
non-5xx failures получают `recommended_action: fix_env` и подавляют
misleading `fix_test_logic`/`schema_hint`.

Round-3 review (2026-04-30) выявил, что **сам detector триггерится узко** —
только на failures, у которых проблема возникает на уровне всей коллекции
(missing `{{auth_token}}` сразу везде, базовый URL не отвечает, и т.п.).

Реальные сценарии env_issue, которые сейчас проскакивают мимо детектора и
снова дают пользователю misleading hint:

- **Per-suite missing variable.** `{{stripe_key}}` нужен только для одного
  suite (payments), его нет в `.env.yaml`. Вся коллекция не падает —
  падает только этот suite, но для него root-cause всё равно env, не код.
- **DNS / connection refused на одном host.** Suite использует
  `{{webhook_base_url}}`, который указывает на закрытый dev-host — net
  errors локализуются в одном suite, env_issue не выставляется.
- **Auth token истёк.** Часть запросов 401 (token expired), часть 200
  (открытые endpoints). Detector видит «не все failures одного класса» и
  не помечает env_issue, хотя 100% 401-failures имеют `fix_env` корень.

## Что сделать

Расширить env_issue detector от «всё или ничего на уровне run» до
**кластерной классификации**:

1. Группировать failures по suite-id и по failure_class. Если внутри
   кластера ≥80% failures имеют env-симптомы (missing variable, DNS,
   connect-refused, 401/403 с явным auth-header reference) — пометить
   **suite-level env_issue** и применить override к этим failures.
2. Сохранить run-level env_issue как агрегатор: «X из Y suites имеют
   env_issue, корневые причины: missing_var=…, network=…, auth_expired=…».
3. На уровне reporter — печатать env_issue scope (`run` / `suite:<name>`)
   рядом с `recommended_action`, чтобы пользователь видел границы проблемы.
4. Не ломать существующее поведение для 5xx — backend bugs остаются
   `report_backend_bug`, env override на них не распространяется.

## Acceptance

- Suite-scoped missing variable → suite-level env_issue, recommended_action =
  fix_env у всех его failures.
- Mixed run (один suite с истёкшим token, остальные ок) → run завершается
  не как сплошной env_issue, но в diagnose видно `env_issue.scope: suite:auth`.
- 5xx failures не получают fix_env override ни при каких условиях.
- Документация в reporter / `db diagnose --json` envelope обновлена:
  поля `env_issue.scope`, `env_issue.affected_suites[]`,
  `env_issue.symptoms{}`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Per-suite env_issue: missing var в одном suite → suite-scoped env_issue, fix_env override только в этом suite
- [ ] #2 Mixed-run остаётся mixed: report показывает env_issue.scope=suite:<name>, не глобальный fix_env
- [ ] #3 5xx failures сохраняют report_backend_bug даже при наличии env_issue в run
- [ ] #4 JSON envelope: env_issue.scope, env_issue.affected_suites[], env_issue.symptoms{} — задокументированы в ZOND.md
<!-- AC:END -->
