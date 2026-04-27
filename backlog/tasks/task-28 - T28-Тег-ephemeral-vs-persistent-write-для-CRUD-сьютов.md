---
id: TASK-28
title: 'T28: Тег [ephemeral] vs [persistent-write] для CRUD-сьютов'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 13:42'
updated_date: '2026-04-27 14:24'
labels:
  - generator
  - tags
milestone: m-1
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Текущая конвенция `[smoke] / [crud] / [unsafe]` не различает:
- **ephemeral**: create→use→delete внутри одного suite (после прогона состояние API не меняется).
- **persistent-write**: create без cleanup (оставляет хвосты в API).

Для CI важно по дефолту запускать только ephemeral writes; persistent-writes требуют явного opt-in.

## Что сделать

- Добавить теги `[ephemeral]` и `[persistent-write]`.
- В `zond generate` помечать сьюты с финальным `delete` шагом → `[ephemeral]`, остальные write-сьюты → `[persistent-write]`.
- `zond run --tag ephemeral` / `--tag '!persistent-write'` для фильтрации.
- Обновить CI-шаблоны (`zond ci generate`) на дефолт `--tag '!persistent-write'`.

## Acceptance

- Теги проставляются генератором автоматически.
- Документировано в ZOND.md и в Definition of Done для тестов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 generateCrudSuite проставляет ephemeral/persistent-write автоматически по наличию DELETE в group
- [x] #2 CI-шаблоны (github/gitlab) по дефолту исключают persistent-write и needs-id (из T27)
- [x] #3 Документация ZOND.md описывает семантику тегов и рецепты фильтрации
- [x] #4 Тесты покрывают оба варианта (с delete и без)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План

1. **`src/core/generator/suite-generator.ts:generateCrudSuite`** — теги динамически: `[crud, ephemeral]` если `group.delete` существует, иначе `[crud, persistent-write]`.
2. **`src/cli/commands/ci-init.ts`** — оба шаблона (GitHub Actions + GitLab CI):
   - Smoke step: `--exclude-tag needs-id` (T27 — позитивная smoke без реальных ID не запускается).
   - CRUD step: `--exclude-tag persistent-write` (по умолчанию только безопасные ephemeral CRUD-сьюты), с комментарием как включить.
3. **`ZOND.md`** — раздел про теги + filtering-рецепты.
4. **Тесты** — новые кейсы в `tests/generator/suite-generator.test.ts`: ephemeral при delete, persistent-write без delete.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/generator/suite-generator.ts:generateCrudSuite`:**
- Тег классификации добавлен динамически: `group.delete ? "ephemeral" : "persistent-write"`.
- Suite tags теперь `["crud", cleanupTag]`.
- Логика: если в CrudGroup есть DELETE-эндпоинт → сьют сам подчищает (включает `Delete + Verify deleted` шаги) → `ephemeral`. Иначе → создаёт ресурсы без cleanup → `persistent-write`.

**`src/cli/commands/ci-init.ts` — CI-шаблоны:**
- GitHub Actions:
  - Smoke step: добавлен `--exclude-tag needs-id` (skip позитивных T27-сьютов без реальных ID).
  - CRUD step: добавлен `--exclude-tag persistent-write`, переименован в "ephemeral suites only", добавлен комментарий как opt-in для persistent-write.
- GitLab CI: те же изменения в обоих jobs (api-smoke, api-crud).

**Тесты:**
- `tests/generator/suite-generator.test.ts`:
  - Существующий тест "generates CRUD chain with capture and verify" обновлён: ожидает теги `["crud", "ephemeral"]` (имеет DELETE).
  - Новый тест "CRUD suite WITH delete is tagged ephemeral".
  - Новый тест "CRUD suite WITHOUT delete is tagged persistent-write".

**`ZOND.md`:**
- Phase 2 раздел расширен описанием семантики `ephemeral`/`persistent-write` + filtering-рецепты.
- Упомянут дефолт `zond ci init` для CRUD job (`--exclude-tag persistent-write`).

**Связь с T27:**
- CI-шаблоны теперь учитывают оба тега из обоих задач:
  - Smoke job: `--exclude-tag needs-id` (T27).
  - CRUD job: `--exclude-tag persistent-write` (T28).
- Безопасный first-run на свежем API: smoke только над paramless+negative, CRUD только над ephemeral.

**Решения:**
- Тег `ephemeral` намеренно не зависит от того, делает ли сьют GET до и после create — единственный надёжный сигнал «полный cleanup» это наличие финального DELETE на созданный ресурс. CrudGroup.delete уже это отражает.
- Опционально можно было бы детектить «частично-ephemeral» (POST + PUT без DELETE) — но это всё равно persistent-write по определению (ресурс остаётся).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Auto-classification CRUD-сьютов по cleanup-поведению.

**Изменения:**
- `generateCrudSuite` ставит `[crud, ephemeral]` если в group есть DELETE, иначе `[crud, persistent-write]`.
- CI-шаблоны (GitHub Actions + GitLab CI) теперь по дефолту:
  - Smoke job: `--exclude-tag needs-id` (T27-aware).
  - CRUD job: `--exclude-tag persistent-write` (только ephemeral).
- ZOND.md описывает семантику тегов и filtering-рецепты.

**Файлы:**
- `src/core/generator/suite-generator.ts` — динамический cleanup-tag в CRUD suite
- `src/cli/commands/ci-init.ts` — CI-шаблоны с tag-фильтрацией по умолчанию
- `ZOND.md` — Phase 2 раздел с описанием тегов
- Тесты: suite-generator (+2, обновлён 1)

**Тесты:** 656/656 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
