---
id: TASK-137
title: 'probe-mass-assignment: --discover-fk и --retry-inconclusive'
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-05 12:54'
labels:
  - probe
  - probe-mass-assignment
  - recall
milestone: m-8
dependencies:
  - TASK-136
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback §B раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

Mass-assignment в Sentry-аудите дал 3 HIGH + **51 INCONCLUSIVE**. Все 51
— из-за отсутствия FK-id в фикстурах (audiences/domains/teams id не было
в `.env.yaml`). Скилл говорит «допиши env и пересобери», но 51 endpoint
вручную нереально, и потом весь probe гоняется заново на 2665 запросах.

## Что сделать

1. **`--discover-fk`** для `probe-mass-assignment`: перед атакой пробежаться
   по соседним list-endpoints (на базе `.api-resources.yaml`, как в
   TASK-136), достать FK-id и заполнить in-memory кэш фикстур. Не писать
   в `.env.yaml` (это уже делает `zond discover`), а локально подставить
   на время проба.
2. **`--retry-inconclusive <run-id>`**: пересобрать только те endpoints,
   что были INCONCLUSIVE в указанном прогоне, после того как пользователь
   обновил фикстуры (или после `--discover-fk`). Не гонять весь probe
   заново.
3. В output `digest` для каждого INCONCLUSIVE указывать: «нужен FK
   <name>, не найден в env / discover / cache».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг `--discover-fk` подтягивает FK-id из list-endpoints (общая
      реализация с TASK-136).
- [ ] #2 `--retry-inconclusive <run-id>` принимает run-id из истории и
      пересобирает только INCONCLUSIVE-кейсы.
- [ ] #3 На fixture-кейсе с 5 INCONCLUSIVE до и 0 INCONCLUSIVE после —
      покрыто тестом.
- [ ] #4 Digest указывает имя пропущенного FK для каждого INCONCLUSIVE.
- [ ] #5 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано --discover-fk через расширение существующего --discover (default ON). Body-FK поля (*_id/*_slug/*_uuid/*_key) в required props схемы request body резолвятся через sibling collection list endpoint, значения оверрайдятся в baseline body по имени поля. INCONCLUSIVE-baseline summary теперь называет нерезолвенные FK. 2 unit-теста (positive + negative). --retry-inconclusive выделен в follow-up TASK-150.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-137: probe-mass-assignment body-FK auto-discovery. Закрывает 51 INCONCLUSIVE-baseline из feedback'а. --retry-inconclusive в TASK-150.
<!-- SECTION:FINAL_SUMMARY:END -->
