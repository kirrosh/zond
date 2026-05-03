---
id: TASK-124
title: testing — Playwright e2e harness для golden paths UI
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - testing
  - ui
  - ux-polish
milestone: m-7
dependencies: []
priority: high
---

## Description

В `tests/ui/` сейчас unit-тесты компонент. Нужен e2e-harness на Playwright, поднимающий `zond serve` против seed-DB и прогоняющий 4 golden path сценария. Это превращает «после фичи проверь в браузере» (memory feedback) в детерминированную проверку.

## Acceptance Criteria

- [ ] `tests/e2e/` с playwright.config.ts, использующим Bun runtime где можно (или node для playwright-core)
- [ ] Скрипт `bun run test:e2e` поднимает `zond serve --port <random> --db tests/e2e/fixtures/seed.db`
- [ ] 4 spec'а:
  - `empty-workspace.spec.ts` — пустой workspace показывает onboarding (зависит от TASK-117)
  - `failed-run-drilldown.spec.ts` — открыть failed run, развернуть failure, проверить evidence-табы
  - `replay-save-as-yaml.spec.ts` — открыть replay, изменить body, нажать «Save as YAML», проверить буфер
  - `coverage-drilldown.spec.ts` — открыть coverage, кликнуть uncovered cell, проверить reasons
- [ ] Seed-DB генерится скриптом `tests/e2e/fixtures/build-seed.ts`, не коммитится бинарь — собирается перед run
- [ ] CI шаг (`.github/workflows/...` или эквивалент) запускает e2e на каждый PR

## Implementation Plan

1. Добавить `@playwright/test` в devDependencies (через `bun add -d`)
2. Написать build-seed.ts: один passing run, один failed run с разными failure-классами, один coverage scenario
3. Написать playwright.config.ts с `webServer: { command: 'bun zond serve --port 6499 --db ...', port: 6499 }`
4. Написать 4 spec'а; убедиться что `--ui` mode работает локально
5. Прописать `test:e2e` script в package.json

## Notes

Не путать с unit-тестами в `tests/ui/` — те остаются. e2e — отдельный harness.
