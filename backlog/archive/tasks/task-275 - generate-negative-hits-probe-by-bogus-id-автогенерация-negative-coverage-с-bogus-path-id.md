---
id: TASK-275
title: >-
  generate --negative-hits / probe-by-bogus-id: автогенерация negative-coverage
  с bogus path-id
status: Done
assignee: []
created_date: '2026-05-08 18:00'
updated_date: '2026-05-08 13:21'
labels:
  - feedback-loop
  - api-sentry
  - generate
  - probes
  - high-leverage
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13 TL;DR, class missing-feature, high-leverage.

В сессии 11% coverage за 5 минут было закрыто **руками**: тестер дописал ~60 хитов с bogus path-id (`/replays/00000.../`, `/issues/99999/`, `/sourcemaps/abc/`) — это паттерн «trigger code path with bogus id», который generator не покрывает: он видит контракт (enum/pattern), но не «bogus id для negative coverage».

Сейчас этого паттерна как команды нет:
- positive CRUD chain → не пишет negative-by-id хиты;
- probes (`validation`/`security`/`mass-assignment`) → ищут уязвимости, не coverage;
- единственный путь — копипаста YAML руками.

Expected: новая команда / флаг, например:
- `zond generate --negative-hits` или `zond probe by-bogus-id`;
- для каждого endpoint c `{*_id|*_slug|*_uuid}` в path → один YAML-test с bogus value (`00000000-0000-0000-0000-000000000000` для uuid, `99999` для int, `nonexistent` для slug, спец-кейсы для int+padded);
- expect.status — array `[404, 400]` (или 410 для soft-delete) — toleratorсо schema drift через TASK-249;
- output как отдельный suite-файл `negative-by-id.yaml` рядом с CRUD-сьютом, чтобы coverage-union сразу учёл их.

Impact: 5 минут вместо 5 часов копипасты для каждого нового API; closes 11% coverage gap «в одно нажатие».

Actual: ручная работа, прецедент «жгу 11% coverage за 5 минут руками» подтверждён в feedback-13.

Связано: TASK-49 (negative input probe), TASK-27 (smart smoke), TASK-263 (format/example awareness).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] #1 CLI: новая команда (или флаг к `generate`) с явным `--help`, документирующим назначение pattern «bogus id → expect 4xx».
- [x] #2 Per-FK эвристика выбора bogus value по типу (uuid/int/slug/email).
- [x] #3 Output — отдельный suite-файл с тегом `negative-by-id` (для `--union tag:` см. TASK-274).
- [x] #4 Expect.status — массив (404/400/410), toleratorсо schema drift; не падать на single-value spec.
- [ ] #5 Verify на Sentry: 60+ negative-hits, прирост hit-coverage ≥ 10% относительно single CRUD-сьюта.
- [x] #6 Idempotent: повторный запуск не дублирует кейсы.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
