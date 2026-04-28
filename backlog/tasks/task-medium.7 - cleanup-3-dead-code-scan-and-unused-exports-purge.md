---
id: TASK-MEDIUM.7
title: 'cleanup 3: dead-code scan and unused exports purge'
status: In Progress
assignee: []
created_date: '2026-04-28 12:02'
updated_date: '2026-04-28 12:43'
labels:
  - cleanup
  - tech-debt
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После выпила MCP и накатывания пары циклов фич есть подозрения на мёртвый код. Прогон под `ts-prune` или `knip` — стандартная гигиена.

## Scope
- Установить инструмент: `bun add -d knip` (или `ts-prune`).
- Запустить `bunx knip --reporter symbols` против `src/`.
- Список найденного — закоммитить в `backlog/notes/cleanup-3-knip-output.md` для прозрачности.
- Удалить:
  - явно никем не использованные экспорты (особенно после удаления `src/mcp/` и `src/core/install/`);
  - dead enum-варианты (e.g. `Integration = "mcp"` если cleanup-1 не дочистил);
  - dead парсеры/сериализаторы оставшиеся от удалённых форматов.
- Добавить в `scripts/check-dead-code.ts` или `package.json` script `bun run lint:dead` для регулярных проверок.
- Optionally: добавить в CI (но это уже стрелочка к TASK-LOW.1+, отдельная задача).

## Acceptance
- `knip` проходит без unused exports / files / dependencies в src/.
- `bun test` зелёный (значит, ничего нужного не удалили).
- В CHANGELOG строка "### Internal — dead code purge".

## Не в скоупе
- **`src/web/`** — оставляем целиком, согласно decision-3 (zond serve keep). knip не должен помечать его символы как unused. Конфигурация: добавить `entry: ["src/web/server.ts"]` или `ignore: ["src/web/**"]`.
- **`src/core/exporter/postman.ts`** — оставляем, согласно decision-4. То же — exclude из pruning.
<!-- SECTION:DESCRIPTION:END -->
