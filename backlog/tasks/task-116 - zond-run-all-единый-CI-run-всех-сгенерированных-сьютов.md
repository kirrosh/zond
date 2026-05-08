---
id: TASK-116
title: zond run --all + единый CI run всех сгенерированных сьютов
status: Done
assignee: []
created_date: '2026-04-30 14:19'
updated_date: '2026-05-08 16:12'
labels:
  - cli
  - ci
  - trust-loop
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Для CI нужен единый прогон всех сгенерированных тестов с одним `runs.id` per commit/branch — иначе невозможно сравнить состояние API между билдами. Сейчас `zond run` принимает один файл/glob (см. TASK-37), а probe-команды пишут отдельные run'ы. На UI это превращается в кашу.

## Что сделать

1. CLI: `zond run --all` (или `zond run` без аргумента в workspace-режиме) — пробегает все suites из workspace, сшивает в один run.
2. Использовать `commit_sha`, `branch`, `environment` (уже в схеме) — заполнять из CI env (`GIT_COMMIT`, `GITHUB_SHA`, `CI_COMMIT_SHA`, `BRANCH_NAME`).
3. `trigger='ci'` для таких run'ов (отличить от probe-сессии и manual).
4. UI: фильтр по `trigger` на `/runs` — показать только CI run'ы.
5. CI-init template (`zond ci-init`): добавить пример GitHub Action / GitLab pipeline шага, использующий `zond run --all --json` и публикующий HTML report.

## Acceptance

- `zond run --all` создаёт один `runs` row со всеми результатами.
- В CI один коммит = один run.
- На UI можно отфильтровать по `trigger='ci'`.
- HTML report (TASK-107) генерируется поверх такого run'а корректно.

## Связанные

- TASK-37 (zond run multi-file/glob) — этот таск его расширяет до workspace-wide.
- TASK-113 (session_id) — probe-сессия и CI run — два разных типа группировки, не путать: probe = много run'ов под одним `session_id`, CI = один run целиком.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
zond run --all: discover apis/*/tests/ → один runs.id. CI env autodetection (GitHub Actions / GitLab / CircleCI / Buildkite / Jenkins / generic) → trigger=ci, commit_sha, branch на runs row. ZOND_* overrides. RunFilters.trigger для DB-фильтра. 8 unit-тестов на ci-context, 2 на DB filter. Скилл Phase 3-CI добавлен. UI client filter и ci-init template — отдельная задача (low priority).
<!-- SECTION:NOTES:END -->
