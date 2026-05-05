---
id: TASK-132
title: zond request --api <name> — резолв base_url из .env.yaml
status: To Do
assignee: []
created_date: '2026-05-05 10:04'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас `zond request POST /posts --body '{}'` падает с «fetch() URL is invalid», потому что путь относительный и base_url ниоткуда не резолвится. Приходится писать полный URL, что ломает консистентность с `zond run` (где `{{base_url}}` подставляется автоматом).

Надо: при наличии флага `--api <name>` подхватывать base_url из `apis/<name>/.env.yaml` и склеивать с относительным путём. Без `--api` поведение прежнее (полный URL обязателен).

Источник: фидбэк по JSONPlaceholder (затык №4 + №7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond request --api <name> POST /path склеивает base_url из .env.yaml
- [ ] #2 без --api поведение не меняется
- [ ] #3 понятная ошибка если --api указан, но API не зарегистрирован
<!-- AC:END -->
