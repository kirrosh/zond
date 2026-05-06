---
id: TASK-173
title: 'report --redact-identity: opt-in для outbound шеринга'
status: To Do
assignee: []
created_date: '2026-05-06 06:55'
labels:
  - redaction
  - report
  - identity
dependencies:
  - TASK-174
milestone: m-10
priority: low
---

## Description

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

## Acceptance Criteria

- [ ] `--redact-identity` доступен на `report case-study`, `report html`, `report digest`.
- [ ] Без флага — identity values видны как обычно.
- [ ] С флагом — identity заменяется на `<identity:<key>>`.
- [ ] Placeholder отличается от secret-redaction marker.
- [ ] Документация: когда использовать.
- [ ] Тест: HTML с `--redact-identity` не содержит org_slug из `.identity.yaml`.
