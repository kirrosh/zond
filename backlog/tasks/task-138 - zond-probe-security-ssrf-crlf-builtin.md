---
id: TASK-138
title: 'zond probe-security <classes> — встроенные SSRF/CRLF/open-redirect'
status: To Do
assignee: []
labels:
  - probe
  - probe-security
  - cli
milestone: m-8
dependencies: []
priority: high
---

## Description

## Контекст

Источник: [m-8 feedback §F + §2 раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

Phase 5.2/5.3 скилла даёт **текстовые шаблоны** SSRF/CRLF в markdown.
В Sentry-аудите: HIGH-находка по stored CRLF injection (samый ценный
результат раунда) сделана за 5 минут — но это была ручная копипаста
шаблона. Это ровно тот бойлерплейт, который должен жить в подкоманде:
автоопределение полей по spec-каталогу + единая схема прогона + idempotent
cleanup.

Дополнительно §F: SSRF-probe на `POST /sentry-apps/` дал 5 × 404 (endpoint
не доступен с этим scope), 0 информации. Нужен baseline-OK шаг до атаки.

## Что сделать

Команда: `zond probe-security <class>[,<class>...] [--api <name>] [--scope <tag>...]`.

Поддерживаемые классы (минимально):
- `ssrf` — поля типа `*Url`, `webhook`, `callback`, `redirect_uri`,
  пейлоады из встроенного списка (loopback, link-local, file://,
  internal DNS).
- `crlf` — поля типа `*Prefix`, `subject`, `name`, `description`,
  пейлоады с `\r\n` инъекцией заголовков.
- `open-redirect` — поля `redirect`, `next`, `return_to`.

Для каждого endpoint'а (на базе `.api-catalog.yaml`):

1. **Baseline-OK шаг.** Послать полностью валидный body (из фикстур) и
   убедиться, что endpoint достижим с текущим auth. Если 4xx —
   suite помечается `SKIPPED-INCONCLUSIVE` с причиной (как уже делает
   probe-mass-assignment, см. §F фидбэка).
2. **Атака.** Подменить целевое поле пейлоадом, послать запрос.
3. **Cleanup.** Idempotent `always: true` шаги — restore original
   значения, чтобы не оставлять следов на проде (это уже работает в
   ручных YAML, нужно по умолчанию).
4. **Verdict.** На основе response status / body matching определить
   PASS / FAIL / INCONCLUSIVE.

Дополнительно:
- `--emit-tests <dir>` — выгрузить YAML-сьюты для регрессии (как уже
  делает probe-mass-assignment).
- `--dry-run` — показать, какие endpoints + поля будут атакованы.

## Acceptance Criteria

- [ ] Команда `zond probe-security <classes>` зарегистрирована, классы
      `ssrf` и `crlf` работают (open-redirect — опционально).
- [ ] Автоопределение полей по `.api-catalog.yaml` (имя/тип/spec hint).
- [ ] Baseline-OK шаг перед каждой атакой; при baseline 4xx — `SKIPPED`.
- [ ] Idempotent cleanup (capture original → restore) для stateful
      endpoints.
- [ ] `--emit-tests` выгружает регрессионные YAML.
- [ ] Тесты на детектор полей и на baseline-skip ветку.
- [ ] Скилл Phase 5.2/5.3 заменяет markdown-шаблоны на ссылку на
      команду (с примерами).
- [ ] CHANGELOG.
