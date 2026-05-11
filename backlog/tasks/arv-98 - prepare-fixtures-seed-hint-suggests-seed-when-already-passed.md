---
id: ARV-98
title: prepare-fixtures --seed hint suggests --seed when already passed
status: Done
assignee: []
created_date: '2026-05-11 08:15'
updated_date: '2026-05-11 08:26'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3, class ux-papercut/likely_bug
API: sentry

Repro:
  zond prepare-fixtures --api sentry --apply --cascade --seed
  # → failed:miss-empty replay_id … (no replays in target API — re-run with
  #   'zond prepare-fixtures --api <name> --seed --apply' to POST-create one
  #   automatically, or create the resource yourself …)

Expected: либо seed-попытка POST-create реально срабатывает (или фейлится с конкретной причиной — 'POST endpoint не найден в spec', '422 schema gap'), либо хинт честно говорит 'seed невозможен по такой-то причине' и помечает var как skip-coverage.

Actual: хинт буквально просит запустить опцию, которая уже была передана. Похоже что seed-fallback не сработал (для Sentry /replays POST-эндпоинта нет в spec — ресурсы создаются SDK), но сообщение это не отражает.

Effect: невозможно понять, проигнорирован ли --seed, был ли он попыткой (и почему не получилось), или это просто стейлый текст. Агент крутит цикл повторных запусков.

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log блок '=== prepare-fixtures --apply --cascade --seed ==='
Related: skill-drift SD4
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When --seed already passed, the miss-empty hint reflects what was tried
- [x] #2 If POST endpoint absent in spec, hint says so explicitly
- [x] #3 Test pins the new wording for replay_id-style cases
<!-- AC:END -->
