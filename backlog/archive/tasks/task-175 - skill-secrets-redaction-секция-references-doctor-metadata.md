---
id: TASK-175
title: 'skill: secrets & redaction секция (references + doctor metadata)'
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 11:19'
labels:
  - skill
  - docs
  - secrets
milestone: m-10
dependencies:
  - TASK-166
  - TASK-169
  - TASK-170
  - TASK-172
  - TASK-174
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §5.

После имплементации m-10 изменяется workflow для агента:

- НЕ читать `.env.yaml` напрямую для понимания «что есть».
- Использовать `zond doctor --api <name> --json` — metadata-only.
- Знать про `.secrets.yaml`, `.identity.yaml`, `${ENV}`, `@secret:`,
  `@identity:` syntax.
- При генерации команд для пользователя — использовать references,
  не литералы (`auth_token: "@secret:auth_token"`, не
  `auth_token: "sntry_..."`).
- Понимать, что `--no-redact` существует, но просить не использовать
  для outbound-артефактов.

Зависит от: TASK-166 (registry), TASK-169 (`${ENV}`), TASK-170
(`@secret`), TASK-172 (doctor metadata), TASK-174 (.identity.yaml).

## Что сделать

1. Новая секция skill'а **«Secrets & redaction»** (или подсекция в Phase 1/2):
   - что такое `.secrets.yaml`, `.identity.yaml`, `${ENV}`, `@secret:`.
   - почему агент НЕ должен запрашивать raw-секреты.
   - `zond doctor --json` как preferred entry-point.
2. Iron rule (как в существующих skill'ах):
   > **Не читай `.secrets.yaml` напрямую.** Используй
   > `zond doctor --api <name> --json` — там metadata о set/unset
   > и длине, без значений.
3. Entry-point row:
   | «Какие переменные нужны для API X» | `zond doctor --api <name> --json` |
4. Phase про шеринг (Phase 7?): «Перед outbound-шерингом запусти
   `zond report ... --redact-identity` для двойной защиты».
5. Update `init` template skill (включая AGENTS.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Секция «Secrets & redaction» в skill'е.
- [ ] #2 Iron rule про не-читать `.secrets.yaml` напрямую.
- [ ] #3 Entry-point row про `zond doctor --json`.
- [ ] #4 Phase про safe sharing с `--redact-identity`.
- [ ] #5 Skill в `init` template обновлён.
- [ ] #6 AGENTS.md обновлён.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
init/templates/skills/zond.md: новая секция «Secrets & redaction», iron rule про не-читать-.secrets.yaml-напрямую, entry-point row для doctor --json, обновлены NEVER-rules и Phase 7 (default triage path, --redact-identity, --body-cap).
<!-- SECTION:NOTES:END -->
