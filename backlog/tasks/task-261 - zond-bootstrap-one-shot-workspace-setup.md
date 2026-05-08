---
id: TASK-261
title: 'zond bootstrap --api X: one-shot setup из пустого workspace до заполненного .env'
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
labels:
  - feedback-loop
  - api-sentry
  - cli
  - workflow
  - high-leverage
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "3 главных рычага" #1.

Самое большое узкое место первых 30 минут работы с любым новым API: discover работает только когда `.env.yaml` уже наполовину заполнен. На свежем Sentry workspace 35 path-fixtures пустые, без `organization_id_or_slug` discover не находит ничего, без owned-org `_probe-list-orgs` тоже не сработает. Тестер потратил ~10 минут на каждом раунде на ручное seed-наполнение через jq и curl.

Цель: команда `zond bootstrap --api <name>`, которая закрывает discover-bootstrap loop за 30 секунд:
- дёргает корневые list-endpoints из spec'а (по эвристике: `GET /<root>/`, `GET /server.list*`, `GET /<resource>` без path-params);
- из ответа берёт первый element с `id`/`slug` и кладёт в соответствующее `_id_or_slug` fixture;
- автоматически заполняет auto-provisioned ресурсы (workflow_id/detector_id/key_id/filter_id/rule_id для Sentry-like API через walking nested resources);
- запускает `discover` каскадно после каждого нового root, пока fixtures не стабилизируются.

Опционально `--seed`: создать недостающие seed-ресурсы через POST (с генерацией pattern-aware данных, ср. TASK-252/253).

Impact: один из трёх главных рычагов по версии тестера (см. backlog/notes/feedback-12-impressions.md). Без bootstrap каждый новый API стартует с 3-4 часов ручной возни; с bootstrap — 5 минут.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `zond bootstrap --api X` существует и доступен из `--help`.
- [ ] На свежем Sentry workspace (token + spec, пустой `.env.yaml`) → ≥80% path-fixtures заполняются автоматически.
- [ ] `--seed` создаёт недостающие ресурсы (project/team/monitor) через POST с pattern/enum-aware generator.
- [ ] Cascade: после создания root resource — повторный discover для зависимых (project → rules/keys/...).
- [ ] Idempotent: повторный запуск не дублирует seed-ресурсы и не перезаписывает уже заполненные fixtures без `--force`.
- [ ] Verify: на чистом workspace `zond add api sentry --spec ... && zond bootstrap --api sentry --seed` → `zond run apis/sentry/tests` показывает ≥60% pass без правки `.env.yaml` руками.
<!-- SECTION:ACCEPTANCE:END -->
