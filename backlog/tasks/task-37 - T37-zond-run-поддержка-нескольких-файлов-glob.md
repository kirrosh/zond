---
id: TASK-37
title: 'T37: zond run поддержка нескольких файлов / glob'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
updated_date: '2026-04-29 08:42'
labels:
  - cli
  - ux
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond run file1.yaml file2.yaml` молча принимает только первый аргумент — commander по дефолту берёт `[path]` как single. Это путает: glob-привычка из `pytest`/`jest` не работает.

## Что сделать

Вариант A (минимальный): валидировать что `args.length <= 1`, при `> 1` печатать ошибку с подсказкой использовать каталог или повторить `zond run` дважды.

Вариант B (полный): принять `[paths...]` (rest), парсить каждый и объединить suites из всех путей.

## Acceptance

- `zond run a.yaml b.yaml` либо запускает оба, либо выдаёт явную ошибку (не silently игнорирует второй).
<!-- SECTION:DESCRIPTION:END -->
