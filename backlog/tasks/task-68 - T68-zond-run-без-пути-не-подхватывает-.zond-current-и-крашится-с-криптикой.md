---
id: TASK-68
title: 'T68: zond run без пути не подхватывает .zond-current и крашится с криптикой'
status: Done
assignee: []
created_date: '2026-04-29 08:38'
updated_date: '2026-04-29 08:55'
labels:
  - bug
  - cli
milestone: m-3
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сессия #2 показала: `zond run --safe --json` без пути падает с "Failed to resolve --api: The 'paths[0]' property must be of type string, got boolean". Это утечка Node-овской path.resolve() — boolean флаг `--safe` куда-то попадает где ожидается строка-путь. .zond-current выставлен через `zond use resend` — но run его не подхватывает.

Workaround на всю сессию: `zond run apis/resend/tests --safe`. Top-5 ROI fix.

## Что сделать

1. resolveApi (или эквивалент) должен принимать boolean-флаги без падения.
2. Если путь не передан — fallback на .zond-current (workspace root walk-up уже есть).
3. Если ничего не разрешилось — понятная ошибка "No path given and .zond-current not set; run 'zond use <api>' or pass path explicitly".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond run --safe (без пути) использует .zond-current если он выставлен
- [x] #2 Понятная ошибка если .zond-current не задан и пути нет (вместо 'paths[0] must be of type string, got boolean')
- [x] #3 Тип-чек на boolean флагах перед resolveApi
<!-- AC:END -->
