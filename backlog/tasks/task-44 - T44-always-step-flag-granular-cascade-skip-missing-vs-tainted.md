---
id: TASK-44
title: 'T44: always-step flag + granular cascade-skip (missing vs tainted)'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 16:04'
updated_date: '2026-04-27 16:08'
labels:
  - runner
  - generator
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-сессия выявила ловушку: POST /audiences вернул 201, expect стоял 200, status assertion упала → executor пометил все captures из этого шага как failed → DELETE step cascade-скипнулся → ресурс остался "orphan". Хотя capture `audience_id` фактически извлёкся корректно (201 + body.id есть).

Две связанные проблемы:

1. **failedCaptures смешивает два понятия:** "missing" (поля нет в response) и "tainted" (есть, но другая assertion упала). Из-за этого capture, фактически валидный, нулифицируется при любом fail.
2. **Нет способа форсировать cleanup-step.** Для shared-state API (Resend audiences/contacts/webhooks) после первого fail все cleanup'ы скипаются → накапливается state.

## Что сделать

### Часть 1 — granular cascade-skip

В `src/core/runner/executor.ts`:

- Заменить `failedCaptures: Set<string>` на два set'а: `missingCaptures` (capture отсутствует в response) и `taintedCaptures` (есть, но другая assertion в том же step'е упала).
- Cascade-skip non-always step → skip на missing OR tainted.
- Cascade-skip always step → skip только на missing.

Это уже само по себе закрывает большинство кейсов: если capture извлёкся, а упала только status — DELETE с `{{audience_id}}` сработает.

### Часть 2 — always-step flag

В `src/core/parser/types.ts` + `schema.ts`:
```ts
export interface TestStep {
  ...
  always?: boolean;
}
```

В executor:
- Cascade-skip пропускает always-шаги (см. часть 1).
- skip_if-логика остаётся (skip_if всегда срабатывает, даже на always-step — это явный условный пропуск).

В serializer:
- Добавить `always: true` в YAML вывод.

### Часть 3 — генератор

В `src/core/generator/suite-generator.ts:generateCrudSuite`:
- DELETE-step и "Verify deleted" GET-step → `always: true` (для ephemeral-сьютов).

### Часть 4 — документация

ZOND.md:
- Описать `always: true` для cleanup.
- Объяснить cascade-skip semantics: missing vs tainted.

## Acceptance

- TestStep поддерживает `always: true`.
- Failed POST → tainted capture → не-always шаги скипаются, always-шаг с тем же capture запускается.
- Генератор автоматически проставляет `always: true` для DELETE/verify в CRUD ephemeral.
- Тесты покрывают: granular taint, missing-blocks-always, always-runs-on-tainted.
- Документация в ZOND.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TestStep поддерживает always: true в schema/types/serializer
- [x] #2 Failed step разделяет captures на missing (no response field) и tainted (есть, но другая assertion failed)
- [x] #3 Always-step работает на tainted, скипается только на missing
- [x] #4 Генератор проставляет always: true на DELETE и Verify-deleted в CRUD-сьютах
- [x] #5 ZOND.md документирует семантику
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/parser/types.ts` + `schema.ts`:**
- `TestStep.always?: boolean` добавлено в interface и Zod schema (`z.boolean().optional()`).

**`src/core/runner/executor.ts`:**
- `failedCaptures: Set<string>` заменён на два set'а:
  - `missingCaptures` — capture отсутствует в response (no field, no body, network error). Cascade-skip всегда, даже always-шаги.
  - `taintedCaptures` — capture извлёкся, но другая assertion упала. Cascade-skip только для не-always.
- Cascade-skip logic переписан:
  ```ts
  const missing = referencedVars.find((v) => missingCaptures.has(v));
  if (missing) { skip; continue; }
  if (!step.always) {
    const tainted = referencedVars.find((v) => taintedCaptures.has(v));
    if (tainted) { skip; continue; }
  }
  ```
- Каждое место добавления "failed capture" разделено: в substitute-error, URL-invalid, network-error и "not in extracted" → missing; в "step failed but capture in response" → tainted.

**`src/core/generator/serializer.ts`:**
- При `test.always === true` пишет `    always: true` в YAML.

**`src/core/generator/suite-generator.ts:generateCrudSuite`:**
- DELETE-step и Verify-deleted-step в CRUD получают `always: true` автоматически. Для ephemeral-сьютов это гарантирует cleanup даже после fail в POST/UPDATE.

**Тесты:**
- `tests/runner/executor.test.ts` — новый describe "T44 granular cascade-skip + always-step" (4 кейса):
  - Non-always cascade-skip на tainted (status mismatch).
  - Always-step runs on tainted capture (cleanup fires).
  - Always-step still skips on missing capture (no body field).
  - Always-step respects skip_if.
- `tests/generator/suite-generator.test.ts` — новый кейс: DELETE и Verify-deleted в CRUD-сьюте marked always: true.

**ZOND.md:**
- Новый раздел "Cleanup steps (`always: true`)" описывает таблицу skip semantics, синтаксис, и автоматическую расстановку в `zond generate`.

**Решения:**
- `skip_if` имеет приоритет над `always` (явная пользовательская команда). Документировано.
- Существующие тесты на cascade-skip продолжают работать — старая семантика "POST fail → next skip" сохранена через taintedCaptures.
- Capture, который extract'нулся, но не присутствовал в response (не должно случаться), идёт в missing — больше консервативно.
- Generator не делает retry_until/persistent-write шаги always — это всё ещё опциональная цепочка.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cleanup-резистентность: cascade-skip больше не блокирует cleanup-шаги.

**Изменения:**
- TestStep поддерживает `always: true` — шаг запускается даже если предыдущие шаги пометили captures как tainted.
- `failedCaptures` разделён на `missingCaptures` (нет в response — блокирует всё) и `taintedCaptures` (есть, но шаг failed — блокирует только не-always).
- Generator автоматически проставляет `always: true` на DELETE и Verify-deleted в CRUD-сьютах. Failed POST с status mismatch больше не оставляет orphan-ресурсов в API.
- skip_if имеет приоритет над always (явная пользовательская блокировка).

**Файлы:**
- `src/core/parser/types.ts` + `schema.ts` — always flag
- `src/core/runner/executor.ts` — granular missing vs tainted
- `src/core/generator/serializer.ts` — YAML output
- `src/core/generator/suite-generator.ts` — auto-mark CRUD cleanup
- `ZOND.md` — Cleanup steps section с таблицей семантики
- Тесты: executor (+4), suite-generator (+1)

**Тесты:** 686/686 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
