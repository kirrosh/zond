---
id: TASK-170
title: '@secret references + .secrets.yaml файл'
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 11:09'
labels:
  - secrets
  - env
  - loader
milestone: m-10
dependencies:
  - TASK-166
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §1+§2.

Добавить отдельный `.secrets.yaml` файл (gitignored), содержимое
которого автоматически регистрируется в SecretRegistry. В
`.env.yaml` ссылка через `@secret:<name>`:

```yaml
# apis/sentry/.secrets.yaml (gitignored)
auth_token: "sntryu_5731f2e2..."
dsn: "https://...@sentry.io/..."

# apis/sentry/.env.yaml (committable)
auth_token: "@secret:auth_token"
base_url: "https://us.sentry.io"
```

Эффект: чёткая ментальная модель «положил в `.secrets.yaml` — не
попадёт в артефакты». Агент при Read `.env.yaml` видит references,
не raw-токены.

Зависит от TASK-166 (registry). Совместимо с TASK-169 (`${ENV}`) —
обе системы можно использовать одновременно.

## Что сделать

1. **Loader для `.secrets.yaml`:**
   - читается рядом с `.env.yaml` (или в `.zond/secrets.yaml`?).
   - flat key/value, no nesting (упрощение).
   - все values автоматически `registry.register(key, value)`.
2. **Резолвер `@secret:<name>`** в `.env.yaml`:
   - на load-time подставляет value из `.secrets.yaml`.
   - missing key → fail-loud («@secret:auth_token referenced but not defined in .secrets.yaml»).
3. **`zond add api`** при создании API:
   - создаёт `.secrets.yaml` с placeholder `auth_token: "" # required`.
   - дописывает в `.gitignore` строку для `.secrets.yaml` если её нет.
4. **`zond doctor`** упоминает `.secrets.yaml` (set/unset, не показывает values).
5. Документация: ZOND.md секция «Secrets — .secrets.yaml + @secret references».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `.secrets.yaml` создаётся при `zond add api` (placeholder + gitignored).
- [ ] #2 Loader читает `.secrets.yaml` и регистрирует все values в SecretRegistry.
- [ ] #3 `@secret:<name>` в `.env.yaml` резолвится в значение из `.secrets.yaml`.
- [ ] #4 Missing `@secret:<name>` → fail-loud.
- [ ] #5 `.gitignore` обновляется автоматически.
- [ ] #6 `zond doctor` показывает `.secrets.yaml` status (set/unset, длина).
- [ ] #7 Документировано.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/secrets/secrets-file.ts: loadSecretsFile + resolveSecretRefs + loadSecretsFromAncestor. setup-api: создаёт placeholder .secrets.yaml + .gitignore pin. Loader подключен в loadEnvFile (после ENV interp). 6 unit-тестов. E2E проверено: ${VAR} default + override + @secret: → <redacted:auth_token> в JSON output.
<!-- SECTION:NOTES:END -->
