---
id: TASK-155
title: 'skill: probe-security mutation warning + security-only entry point'
status: To Do
assignee: []
labels:
  - skill
  - docs
  - probe-security
milestone: m-8
dependencies:
  - TASK-138
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback round 3 (skill)](../notes/m-8-audit-cli-gaps/feedback-round3.md).

Скилл-секция Phase 5.2 после TASK-138 уже command-first
(`zond probe-security`). Но не хватает двух вещей:

1. **Warning о мутации state.** До TASK-151 (snapshot+restore cleanup)
   probe-security на PUT-rename'ах ломает живые данные. Юзер в раунде
   3 нарвался на DSN-rename без отката. Скилл должен явно
   предупреждать.

2. **Entry-point для security-only audit.** В таблице entry points
   нет пути «нужно проверить только SSRF/CRLF на этом проде» —
   непонятно, что Phase 1–4 можно пропустить.

## Что сделать

1. В Phase 5.2 (`zond.md`) добавить блок:

   > ⚠️ **Mutates state on PUT/PATCH.** До TASK-151 cleanup
   > = `DELETE-if-2xx`, что **не восстанавливает** оригинал на
   > rename'ах (DSN-keys, team-names, webhook URLs могут быть
   > переписаны без отката). Перед прогоном на чужой / shared
   > prod-org обязательно:
   >
   > ```bash
   > zond probe-security ssrf,crlf --api <name> --dry-run
   > ```
   >
   > Просмотри, какие endpoint'ы и поля будут атакованы, и убедись,
   > что среди них нет тех, чьё текущее значение нужно сохранить.

   После закрытия TASK-151 этот warning заменить на ссылку на
   snapshot+restore поведение.

2. В таблицу entry points (в начале skill'а) добавить строку:

   | Запрос пользователя | Команда |
   | --- | --- |
   | …existing rows… | … |
   | "Проверь только security (SSRF/CRLF) на этом API, без CRUD-аудита" | `zond probe-security <classes> --api <name> --dry-run` (затем без --dry-run) |

3. Перекрёстная ссылка из Phase 5.2 на новый entry-point row.

## Acceptance Criteria

- [ ] В Phase 5.2 есть блок ⚠️ с инструкцией про `--dry-run` ПЕРВЫМ
      шагом для shared/prod org.
- [ ] В entry-points таблице есть security-only audit row.
- [ ] После закрытия TASK-151 — warning переписан под snapshot+restore
      поведение (отдельная под-задача / в рамках TASK-151).
