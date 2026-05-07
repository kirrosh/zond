---
id: TASK-99
title: 'TASK-98 follow-up: extend env_issue symptoms beyond missing_api_key-shaped 401'
status: To Do
assignee: []
created_date: '2026-04-30 08:52'
labels:
  - diagnose
  - follow-up
dependencies:
  - TASK-98
milestone: m-5
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

[TASK-98](task-98%20-%20TASK-70-follow-up-broaden-env_issue-detector-beyond-collection-level-failures.md) добавил per-suite env_issue detector с симптомами. Ловит, например, `401 missing_api_key`-кластер как `auth_expired`.

Round-3 verification (2026-04-30) показал: самый частый кейс env-проблемы — **литеральный `{{var}}` идёт на провод** (когда переменная не определена) — пропадает мимо детектора, потому что Resend (и большинство SaaS-API) возвращает на это **400 validation_error**, а не 401.

## Repro

```yaml
# /tmp/env-cluster.yaml — auth_token не определён
name: env-cluster-suite
base_url: "https://api.resend.com"
headers:
  Authorization: "Bearer {{missing_token}}"
tests:
  - { name: t1, GET: /emails, expect: { status: 200 } }
  - { name: t2, GET: /domains, expect: { status: 200 } }
  - { name: t3, GET: /webhooks, expect: { status: 200 } }
```

zond шлёт литеральный `Authorization: Bearer {{missing_token}}` (TASK-75 preflight уже warning'ит). Resend отвечает:

```
400 {"statusCode":400,"message":"API key is invalid","name":"validation_error"}
```

Диагноз:
```
env_issue: null   ← detector не сработал
recommended_action: fix_test_logic   ← misleading
hint: Validation error — check request body fields match the schema
```

## Suggested fix

Добавить дополнительный симптом-сигнал, не зависящий от response status/name:

**`literal_placeholder_in_request`** — детектор сканирует **request URL / headers / body** на presence substring `{{` (или регексп `\{\{[a-zA-Z_][\w]*\}\}`). Если найден — failure классифицируется как env-symptom, независимо от response code/body. Симптом гарантированно точен (false-positive невозможен — буквальный `{{var}}` в проде шлют только если зонд сам его не подставил).

Добавить также `name=validation_error` + `message` содержит "API key" / "token" / "auth" → симптом `auth_invalid` (отдельно от `auth_expired`).

## Acceptance

- На repro выше env_issue не null, scope=`suite:env-cluster-suite`, symptoms содержит `literal_placeholder_in_request: 3`
- Все 3 failure получают `recommended_action: fix_env`
- Hints / schema_hints подавлены
- Не false-positive на test, который реально использует {{var}} в expected response (capture-output не должен триггерить)
- Unit test: suite с 1 failure, чьё request URL содержит `{{undefined}}` → env_issue.symptoms.literal_placeholder_in_request === 1
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 literal_placeholder_in_request symptom detected via {{...}} regex on request URL/headers/body
- [ ] #2 Resend-style 400 validation_error "API key is invalid" classified as auth_invalid symptom
- [ ] #3 On repro suite (3 failures, undefined {{missing_token}}) — env_issue.scope='suite:<name>', recommended_action=fix_env on all 3, hint=null
- [ ] #4 Unit test for literal-placeholder-in-request symptom triggers on 1-failure case
<!-- AC:END -->
