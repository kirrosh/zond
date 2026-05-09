---
id: TASK-169
title: '${ENV_VAR} substitution в .env.yaml'
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 11:09'
labels:
  - env
  - secrets
  - loader
milestone: m-10
dependencies:
  - TASK-166
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §2.

Сейчас `.env.yaml` читается plain — нет подстановки переменных из
shell env. После имплементации можно писать:

```yaml
auth_token: "${SENTRY_AUTH_TOKEN}"
base_url: "${SENTRY_BASE_URL:-https://us.sentry.io}"
```

И коммитить `.env.yaml` без секретов в git (хранятся в shell
environment / CI secrets).

Зависит от TASK-166 (registry) — каждое разрешённое значение из
`${ENV_VAR}`, по эвристике «выглядит как секрет», авторегистрируется.

## Что сделать

1. В `.env.yaml` loader'е:
   - распознавать `${VAR}`, `${VAR:-default}` syntax.
   - читать из `process.env`.
   - undefined `${VAR}` без default → fail-loud с понятной ошибкой.
2. **Не делать heuristic «это секрет».** Регистрация в SecretRegistry
   — opt-in через `@secret:` syntax (TASK-170) или явный flag в
   YAML (`$secret: true`).
   - НО: если var имя содержит `TOKEN|SECRET|PASSWORD|KEY|DSN` —
     warn (не register) с подсказкой «consider marking as secret».
3. **Recursive resolution:** значение из `${VAR}` тоже может содержать
   `${OTHER}` — но не делать (cycle-risk). Один уровень.
4. **Escape:** `\${LITERAL}` → `${LITERAL}` без подстановки.
5. Документация в ZOND.md секция `.env.yaml` — формат, escape, default.
6. Тесты: подстановка, default, undefined fail, escape, env-var с спецсимволами.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `${VAR}` подставляется из `process.env` при загрузке `.env.yaml`.
- [ ] #2 `${VAR:-default}` использует default при отсутствии env.
- [ ] #3 Undefined `${VAR}` без default → ошибка с указанием файла и ключа.
- [ ] #4 Escape `\${...}` работает.
- [ ] #5 Var с suspicious-name (TOKEN/SECRET/...) выдаёт warn с suggest.
- [ ] #6 Документировано в ZOND.md.
- [ ] #7 Тесты на основные сценарии.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/parser/env-interpolation.ts: ${VAR}/${VAR:-default}/escape \${...}. Suspicious-name warn (TOKEN/SECRET/...) deduped. Подключено в loadEnvFile. 9 unit-тестов.
<!-- SECTION:NOTES:END -->
