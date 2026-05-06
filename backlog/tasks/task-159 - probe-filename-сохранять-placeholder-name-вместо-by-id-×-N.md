---
id: TASK-159
title: 'probe filename: сохранять placeholder name вместо by-id × N'
status: To Do
assignee: []
created_date: '2026-05-06 06:38'
labels:
  - lifecycle
  - probe
  - naming
  - qol
dependencies: []
milestone: m-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P3.

Сейчас `{organization_id_or_slug}` и `{project_id_or_slug}` оба
сериализуются как `by-id`:

```
probe-methods-api-0-projects-by-id-by-id-replays-by-id-recording-segments-by-id.yaml
                              ^^ оба placeholder'а сериализованы как "by-id"
```

Невозможно глазом понять, какой endpoint без открытия файла. На
Sentry такие имена встречаются повсюду — by-id × 8.

## Что сделать

Генератор имени probe-файла должен брать имя placeholder'а, не
универсальный `by-id`. Эвристика:

- `{organization_id_or_slug}` → `by-org`
- `{project_id_or_slug}` → `by-proj`
- `{replay_id}` → `by-replay`
- `{segment_id}` → `by-segment`
- `{user_id}` → `by-user`
- общая логика: брать первое слово до `_id`/`_slug`, или canonical short alias.

Длиннее, но различимо:
`probe-methods-api-0-projects-by-org-by-proj-replays-by-replay-recording-segments-by-segment.yaml`

## Acceptance Criteria

- [ ] Generator использует placeholder name, не `by-id`.
- [ ] Алиасы для длинных имён задокументированы (или generator usese canonical short alias).
- [ ] На Sentry-spec нет одинаковых имён файлов в `probe-methods/` и `probe-validation/`.
- [ ] Backward compat: при наличии существующих файлов с `by-id` — warning + флаг `--rename` для миграции (опционально).
<!-- SECTION:DESCRIPTION:END -->
