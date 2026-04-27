---
id: TASK-40
title: 'T40: zond init interactive prompt + delete-API команда'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - cli
  - ux
milestone: m-3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Два связанных UX-зазора:

1. **`zond init` без флагов в пустой директории** создаёт `apis/api/` (default name "api"). Пользователь ждал либо вопрос, либо bootstrap workspace (`zond.config.yml + apis/`). Приходится `rm -rf apis/api && init --spec ... --name resend --force`.

2. **Нет команды удаления API** из workspace. Только ручное `rm -rf apis/<name>` + правка `zond.db`.

## Что сделать

1. **`zond init`** без аргументов в пустой директории:
   - Если spec не задан → spawn prompt: "Bootstrap workspace, register API from spec, or cancel?".
   - Default name детектится из spec.title или каталога.

2. **`zond api remove <name>`** (новая команда):
   - Удаляет collection из `zond.db`.
   - Опциональный `--purge` удаляет директорию `apis/<name>/`.
   - Confirmation prompt по умолчанию.

## Acceptance

- `zond init` в пустом каталоге без флагов даёт понятный диалог, не молча создаёт `apis/api/`.
- `zond api remove resend` удаляет API из БД, спрашивает про fs purge.
<!-- SECTION:DESCRIPTION:END -->
