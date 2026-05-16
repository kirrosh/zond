---
id: TASK-173
title: 'report --redact-identity: opt-in для outbound шеринга'
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 11:25'
labels:
  - redaction
  - report
  - identity
milestone: m-10
dependencies:
  - TASK-174
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §6.

Identity (org_slug, member_id, project_slug) — пограничный случай.
Локальный триаж требует identity («баг проявился на org X с features
Y»). Outbound-шеринг — нет: коллеге не нужен `pe-koshelev-kirill`,
достаточно `<org_slug>` placeholder'а.

Решение: дефолт = identity видно (локальный кейс), opt-in флаг
`--redact-identity` для outbound. Зависит от TASK-174 (`.identity.yaml`)
— оттуда берётся список identity-keys.

## Что сделать

1. **`zond report case-study --redact-identity`** — заменяет все
   значения из `.identity.yaml` на `<identity:<key>>`.
2. **`zond report html --redact-identity`** — то же для HTML-export.
3. **`zond report digest --redact-identity`** для probe-digest'ов.
4. **Маркер:** `<identity:org_slug>` (отличается от `<redacted:>`,
   чтобы было ясно что это identity, не secret).
5. **Stdout-warning при `--redact-identity`:**
   `Note: identity values from .identity.yaml replaced with placeholders. Run with --no-redact-identity to keep originals.`
6. По дефолту identity видно (локальный workflow не страдает).
7. Документация: ZOND.md секция «Sharing reports» — когда использовать
   `--redact-identity`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `--redact-identity` доступен на `report case-study`, `report html`, `report digest`.
- [ ] #2 Без флага — identity values видны как обычно.
- [ ] #3 С флагом — identity заменяется на `<identity:<key>>`.
- [ ] #4 Placeholder отличается от secret-redaction marker.
- [ ] #5 Документация: когда использовать.
- [ ] #6 Тест: HTML с `--redact-identity` не содержит org_slug из `.identity.yaml`.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
redactIdentityIn() в core/identity/identity-file.ts (longest-first, min length 2). --redact-identity флаг для report export (HTML) и report case-study; стрипает identity values на <identity:<key>>. 4 unit-теста.
<!-- SECTION:NOTES:END -->
