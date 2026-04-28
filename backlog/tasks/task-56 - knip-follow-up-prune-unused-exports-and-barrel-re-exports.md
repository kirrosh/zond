---
id: TASK-56
title: 'knip follow-up: prune unused exports and barrel re-exports'
status: To Do
assignee: []
created_date: '2026-04-28 12:46'
labels:
  - cleanup
  - tech-debt
  - knip
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После TASK-MEDIUM.7 `bunx knip` показал ~50 unused exports, преимущественно из barrel-файлов:

- `src/core/diagnostics/render-md.ts` — unused file целиком
- `src/core/parser/index.ts` — unused barrel
- `src/core/runner/index.ts` — unused barrel
- `src/core/generator/index.ts` — много re-exports которые никем не импортируются
- `src/core/reporter/index.ts` — то же
- `src/db/queries.ts` — ~12 функций (getDistinctEnvironments, getCollectionPassRateTrend, listAIGenerations и т.д.) — вероятно остатки от удалённых features
- ~85 unused exported types (Options-интерфейсы команд CLI и т.д.)

## Scope
- Идти по списку `bunx knip` итеративно, для каждого export решать:
  1. Реально мёртв → удалить export.
  2. Public-API намерение (re-export для внешних потребителей) → оставить, добавить в knip.json под `ignoreExports` с комментарием.
  3. Used through dynamic ref (knip может промахнуться) → проверить grep, оставить.
- Удалить файлы `render-md.ts`, barrel'ы `parser/index.ts` и `runner/index.ts` если они правда никем не импортируются.
- Закоммитить пачками по 5-10 правок чтобы git history был читаем.

## Acceptance
- `bun run lint:dead` показывает <10 unused exports (или 0 если возможно).
- `bun run check` чистый, `bun test` зелёный после каждой пачки.

## Не в скоупе
- src/web/ (decision-3 — exclude в knip.json уже)
- src/core/exporter/postman.ts (decision-4 — exclude)

## Связь
Хвост TASK-MEDIUM.7. Делать в спокойном режиме, не одним делегатом — slip risk высокий из-за barrel-импортов.
<!-- SECTION:DESCRIPTION:END -->
