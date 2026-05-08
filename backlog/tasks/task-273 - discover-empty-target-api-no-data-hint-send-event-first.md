---
id: TASK-273
title: 'discover: на пустом target-API без подсказки "send an event/data first" вместо miss-no-id'
status: To Do
assignee: []
created_date: '2026-05-08 18:00'
labels:
  - feedback-loop
  - api-sentry
  - discover
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13#F5, class ux-papercut (известный из feedback-12#F? — но без actionable hint).

На пустом workspace (свежий Sentry-проект без событий/replays/uploads) `zond discover` для `issue_id`, `replay_id`, `file_id` отдаёт `miss-no-id` — это формально корректно, но:

- пользователь не понимает, что зонд **не виноват** — на target-API просто нет ни одного объекта;
- нужны доменные действия в самом сервисе (запушить SDK-event, сделать replay, аплоадить debug file), о которых zond молчит;
- 30 минут гадания на ровном месте.

Expected: для конкретных entity-классов (issue/replay/sourcemap/uploaded-file/profile/feedback) при `miss-no-id` — однострочный pointer:

```
discover: no issue_id found (org has 0 issues).
Hint: trigger a Sentry event (SDK install or `sentry-cli send-event`), then re-run discover.
```

Список «как засеять данные» можно держать в `apis/<name>/.api-catalog/seed-hints.yaml` (per-API), а в дефолте — generic message «no <entity> in target API; create one in the product UI before discover can find ids».

Actual: голый `miss-no-id` без направления.

Связано: TASK-261 (bootstrap), TASK-114 (cascade-skip).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] При `miss-no-id` для FK с известным entity-classом печатать generic hint «no <entity> in target API — create one first».
- [ ] Per-API override через `apis/<name>/.api-catalog/seed-hints.yaml` (опционально), Sentry — со ссылкой на SDK-event/replay/file-upload.
- [ ] Hint подавляется в `--json` (envelope несёт `reason: empty-target` отдельно).
- [ ] Regression: пустой sentry workspace → `discover --api sentry` для issue/replay/file даёт hint, не голый miss.
<!-- SECTION:ACCEPTANCE:END -->
