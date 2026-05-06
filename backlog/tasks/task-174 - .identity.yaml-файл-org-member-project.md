---
id: TASK-174
title: .identity.yaml файл (org/member/project)
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 11:19'
labels:
  - identity
  - env
  - split
milestone: m-10
dependencies:
  - TASK-166
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §1+§6.

Trade-off: identity (`organization_id_or_slug`, `member_id`,
`project_slug`) — это не секрет, но разглашает аккаунт пользователя.
При шеринге case-study наружу хочется placeholder. При локальном
триаже — видеть.

Решение: отдельный `.identity.yaml` файл (gitignored), известный
zond'у, с opt-in `--redact-identity` (TASK-173) для outbound-шеринга.

## Что сделать

1. **Loader `.identity.yaml`** в `apis/<name>/.identity.yaml`:
   - flat key/value, gitignored.
   - значения регистрируются в IdentityRegistry (отдельный от
     SecretRegistry — разное поведение по дефолту).
2. **Merge order при resolve переменных:** `.env.yaml` берёт значения
   из `.identity.yaml` через `@identity:<name>` syntax (или просто
   как fallback для known identity-keys).
   - **Вариант 1 (явный):** `org_slug: "@identity:org_slug"` — как
     `@secret:`, но без redaction by default.
   - **Вариант 2 (implicit):** identity-keys (canonical list:
     `organization_id_or_slug`, `member_id`, `project_id_or_slug`,
     `team_slug`) автоматически читаются из `.identity.yaml` если
     там есть.
   - Рекомендация: вариант 1 — explicit, симметрично с `@secret:`.
3. **`zond add api`** создаёт `.identity.yaml` с placeholder'ами для
   distil'едшихся OpenAPI path-параметров (org/project/team).
4. **`.gitignore`** включает `.identity.yaml`.
5. **`zond doctor`** показывает identity как metadata
   (`identity: true, value: <visible>` — отличается от secret тем,
   что value виден).
6. Документация: ZOND.md, чем `.identity.yaml` отличается от `.secrets.yaml`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `apis/<name>/.identity.yaml` создаётся при `zond add api` (если spec даёт identity-параметры).
- [ ] #2 `@identity:<name>` в `.env.yaml` резолвится в значение.
- [ ] #3 `.gitignore` включает `.identity.yaml`.
- [ ] #4 IdentityRegistry отделён от SecretRegistry (разная политика redaction).
- [ ] #5 `zond doctor` показывает identity values (не маскирует, в отличие от secrets).
- [ ] #6 Документировано отличие .identity vs .secrets.
- [ ] #7 Связанная задача — `--redact-identity` (TASK-173).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/identity/identity-file.ts: loadIdentityFile + resolveIdentityRefs + CANONICAL_IDENTITY_KEYS. Не регистрирует значения в SecretRegistry (отличие от .secrets.yaml). setup-api: создаёт .identity.yaml placeholder для path-параметров из canonical vocabulary. .gitignore pin. 6 unit-тестов.
<!-- SECTION:NOTES:END -->
