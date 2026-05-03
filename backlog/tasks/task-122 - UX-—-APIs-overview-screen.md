---
id: TASK-122
title: UX — APIs overview screen (/apis)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - artifacts
milestone: m-7
dependencies: []
priority: high
---

## Description

Сейчас зарегистрированные APIs видны только в `ApiPicker` на coverage. Нужен отдельный экран `/apis` с health'ом артефактов: per-api spec status (валидна / устарела), количество endpoints, fixtures coverage (сколько path-param env vars заполнено в `.env.yaml`), security schemes без token'ов.

## Acceptance Criteria

- [ ] Маршрут `/apis` со списком зарегистрированных API
- [ ] Каждая строка: name, spec path, endpoints count, % fixtures filled, auth-schemes status
- [ ] Клик на строку → drilldown с list endpoints + конкретные fixtures-gaps (какие env vars не хватает)
- [ ] Кнопка «Refresh from spec» дёргает `zond refresh-api <name>` (или объясняет что нужно сделать в CLI)
- [ ] Ссылка на coverage с pre-selected api filter
- [ ] Пункт `APIs` в верхней навигации
