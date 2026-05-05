---
id: TASK-137
title: 'probe-mass-assignment: --discover-fk и --retry-inconclusive'
status: To Do
assignee: []
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

## Acceptance Criteria

- [ ] Флаг `--discover-fk` подтягивает FK-id из list-endpoints (общая
      реализация с TASK-136).
- [ ] `--retry-inconclusive <run-id>` принимает run-id из истории и
      пересобирает только INCONCLUSIVE-кейсы.
- [ ] На fixture-кейсе с 5 INCONCLUSIVE до и 0 INCONCLUSIVE после —
      покрыто тестом.
- [ ] Digest указывает имя пропущенного FK для каждого INCONCLUSIVE.
- [ ] CHANGELOG.
