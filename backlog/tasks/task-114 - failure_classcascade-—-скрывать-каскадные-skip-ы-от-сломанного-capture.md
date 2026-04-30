---
id: TASK-114
title: failure_class=cascade — скрывать каскадные skip\'ы от сломанного capture
status: Done
assignee: []
created_date: '2026-04-30 14:18'
updated_date: '2026-04-30 14:38'
labels:
  - reporter
  - ui
  - trust-loop
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Когда suite ссылается на capture от предыдущего шага (`leaked_id_21`, `created_user_id` и т.п.) и тот шаг упал, все зависимые шаги получают ошибку вида `Depends on missing capture: leaked_id_21` или `cleanup leaked resource from "..."`. На странице run'а пользователь видит десятки красных строк, хотя реальная причина — одна. Это шум, который маскирует настоящие баги.

В Playwright/Vitest аналогичные ситуации (`beforeAll` failed) дают один корневой failure и `skipped (cascade)` для зависимых тестов.

## Что сделать

1. Runner: при обнаружении missing-capture/dependency-failure ставить `status='skipped'` (вместо `failed`) и `failure_class='cascade'`. В `failure_class_reason` — ссылка на корневой шаг (`suite_name + test_name`, который должен был выдать capture).
2. Reporter (console/json/junit): cascade-skip'ы группируются под их корнем — «GET /contacts/{id} failed → 12 dependent steps skipped (cascade)».
3. UI:
   - На странице run'а cascade-skip'ы по умолчанию свёрнуты под корневым failure (раскрытие по клику).
   - Бейдж `cascade` (отдельный цвет, не путать с обычным `skip`).
   - Счётчик в header run'а: `Failed: 3 · Cascade: 14 · Skipped: 2`.
4. Filter: на `/runs` фильтр «Failed» не должен учитывать cascade — иначе один сломанный фикстурный шаг превращает run в «failed» c десятками красных строк.

## Acceptance

- Cascade-skip'ы помечаются `failure_class='cascade'` и не считаются за `failed` в агрегатах run'а.
- UI группирует их под корневым failure, по умолчанию свёрнуто.
- Существующие классификаторы (`definitely bug`, `unclassified` и пр.) не меняются.

## Связанные

- Дополняет TASK-65 (cross-suite capture propagation): когда capture распространяется через сессию, cascade-логика должна срабатывать корректно поверх неё.
<!-- SECTION:DESCRIPTION:END -->
