---
id: TASK-252
title: 'generator: {{$randomString}} игнорирует pattern: — slug-поля сыпят 400 (Sentry slug regex)'
status: To Do
assignee: []
created_date: '2026-05-08 14:00'
labels:
  - feedback-loop
  - api-sentry
  - generator
  - data-factory
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-11#F1 (вторая итерация после TASK-243), class likely_bug / missing-feature.

После того как TASK-243 убрал junk из CRUD body, generator упёрся в следующий слой: значения `{{$randomString}}` не учитывают `pattern:` из spec'а. Sentry slug-поля имеют `"pattern": "^(?![0-9]+$)[a-z0-9_\\-]+$"` — generator выдаёт `8OmyGLOI` (заглавные буквы) → 400 `Enter a valid slug consisting of lowercase letters, numbers, underscores or hyphens`.

Repro:
```
cd /tmp/zond-fb/sentry/workdir
zond run apis/sentry/tests/crud-teams.yaml --report json --report-out /tmp/x.json
jq '.[].steps[]|select(.name|contains("Create a New Team"))' /tmp/x.json
# request.body.slug = "8OmyGLOI"
# response 400: slug: ["Enter a valid slug consisting of lowercase letters, numbers, underscores or hyphens"]
```

Spec для slug: `"pattern": "^(?![0-9]+$)[a-z0-9_\\-]+$"`.

Expected: при наличии `pattern:` использовать regex-aware random-генератор (regex sampler), либо хотя бы `toLowerCase().replace(/[^a-z0-9_-]/g, '-')`. Альтернатива — отдельный `$randomSlug` helper и автоматический switch когда `field == "slug"` или regex такой формы.

Impact: все resource create со slug-полями (team, project, monitor) ловят 400 на пустом месте — следующий гейтер CRUD coverage (4 из 25 fail в feedback-11#F3 — этот класс).

Log: /tmp/zond-fb/sentry/rounds/raw-11.log + /tmp/c11.json
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] При наличии `pattern:` в string-схеме generator выдаёт значение, соответствующее regex (через regex sampler типа `randexp` или эквивалент).
- [ ] Sentry slug-pattern (`^(?![0-9]+$)[a-z0-9_\\-]+$`) → значение из `[a-z0-9_-]+`.
- [ ] Verify: `zond generate --api sentry --tag Teams` → `crud-teams.yaml` body для `POST /teams/` с slug `[a-z0-9_-]+`. `zond run` → 201, без 400 на slug.
- [ ] Тот же эффект на project/monitor create (slug-поля).
- [ ] Tests: `data-factory.test.ts` покрывает pattern-aware path (smoke + Sentry-style slug-regex).
<!-- SECTION:ACCEPTANCE:END -->
