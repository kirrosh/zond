---
id: TASK-111
title: 'skill: fixture-pack phase + --validate-schema promo + MA/SSRF/CRLF templates'
status: Done
assignee: []
created_date: '2026-04-30 13:42'
updated_date: '2026-04-30 13:56'
labels:
  - skill
  - docs
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Прогон zond на Resend API выявил повторяющиеся боли в скилле:
- 5+ итераций починки CRUD: `{{$randomString}}` падает на формат-валидации, FK-ids нужны реальные.
- `--validate-schema` ловит contract drift (date-формат, enum) — но не подсвечен как recommended.
- `probe-mass-assignment` оставляет 20 INCONCLUSIVE — нет шаблона manual catch-up.
- SSRF и CRLF/header-injection в скилле не упомянуты совсем (для них есть TASK-59, TASK-60 как полноценные probe-классы — пока interim шаблоны).

## Что сделать

Правки в `src/cli/commands/init/templates/skills/zond.md` и `agents.md`:

1. **Phase 2.5 — Fixture pack** (новая фаза между Generate и Run): рецепт класть FK-ids, verified-emails и enum-литералы в `.env.yaml` рядом с `auth_token`. Без отдельного fixtures.yaml.
2. **Phase 4a — fixture-pack как первый pass** до typed generators.
3. **Phase 3.3 — --validate-schema в рекомендованной команде** для CRUD с пометкой "включай всегда".
4. **Phase 5.1 — Manual MA catch-up template** (inline YAML-сниппет).
5. **Phase 5.2 — Security probe templates inline** (SSRF + CRLF/header-injection).

Также:
- `zond run --help`: подсветить `--validate-schema` как recommended for CRUD.
- `zond generate` Next-steps: добавить hint про `--validate-schema`.

## Не делаем
- `zond audit` umbrella (есть TASK-55).
- Отдельный fixtures.yaml — `.env.yaml` уже умеет произвольные ключи.
- --validate-schema как hard CLI default — риск ломать loose-схемы.

## Связано
- TASK-21 (env walk-up).
- TASK-59 / TASK-60 — полноценные probe classes (наши templates interim).
- TASK-65 — cross-suite captures.
<!-- SECTION:DESCRIPTION:END -->
