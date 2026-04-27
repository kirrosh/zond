---
id: TASK-19
title: >-
  T19: zond/ subdir convention для embed в существующий проект (zond init
  --here)
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
labels:
  - T19
  - phase-4
  - size-S
  - priority-p1
  - workspace
milestone: m-0
dependencies:
  - TASK-17
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас `zond init` плоско рассыпает `apis/`, `zond.db`, `.api-catalog.yaml` в cwd (`src/core/setup-api.ts:93-97`). Для пустой папки под тестирование 3rd-party API (S1) это OK; для embed в существующий backend-проект (S2) это грязнит корень рядом с `package.json`/`Cargo.toml`.

**Что.** Флаг `zond init --here` создаёт в cwd:
- `zond/` subdir со всем стейтом: `zond/db.sqlite`, `zond/apis/<name>/`, `zond/config.yml`
- Workspace marker — `zond/config.yml` или `zond/` сама по себе (см. T17)
- Апдейт `.gitignore` (если файл существует в cwd): добавить `zond/db.sqlite`, `zond/**/.env*.yaml`
- Ничего НЕ кладёт в корень cwd кроме обновления `.gitignore`

Старое поведение `zond init` (без `--here`) — оставить как было для backwards compat (S1 сценарий).

**Файлы.** `src/core/setup-api.ts`, `src/cli/commands/init.ts`, `src/cli/program.ts` (флаг).

**Зависит от.** T17 (workspace marker) — должен быть согласован формат маркера.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond init --here --name foo --spec X` создаёт `./zond/{config.yml,apis/foo/}` и `./zond/db.sqlite` после первого `zond run`
- [ ] #2 Существующий `.gitignore` дополняется (без дубликатов) строками для `zond/db.sqlite` и env-файлов
- [ ] #3 Без `--here` поведение `zond init` не меняется (`./apis/<name>/` в cwd)
- [ ] #4 После `zond init --here` команда `zond run` (без флагов) находит workspace через walk-up и использует `zond/db.sqlite`
<!-- AC:END -->
