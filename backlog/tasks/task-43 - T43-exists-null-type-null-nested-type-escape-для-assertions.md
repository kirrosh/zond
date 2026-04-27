---
id: TASK-43
title: 'T43: exists/null + type:null + nested-type escape для assertions'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 15:41'
updated_date: '2026-04-27 15:42'
labels:
  - assertions
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-сессия на Resend выявила три ограничения assertion-движка:

1. **`exists: true` ложно фейлится на null-значениях.** В `assertions.ts:40` логика: `actual !== undefined && actual !== null`. Если API возвращает `{schema: null}`, ключ присутствует, но assertion падает с "field is missing". Это конфликтует с JSON-семантикой ("ключ есть → exists=true, независимо от значения"). Нельзя отличить "поля нет" от "поле = null" без обходного `equals: null`.

2. **`type: "null"` не поддерживается.** Enum в `parser/schema.ts:95` ограничен `["string", "integer", "number", "boolean", "array", "object"]`. JSON Schema допускает `"null"` как валидный тип. Без него нельзя кратко проверить null-поле — только через `equals: null`.

3. **Reserved-слово `type` блокирует ассерт поля с этим именем.** Если API-ответ имеет ключ `type` (например `{type: "user", name: "..."}`), пользователь не может написать `body: { type: { equals: "user" } }` — это интерпретируется как assertion-rule "type=user is not in valid type-enum". Workaround есть (dot-notation `"parent.type"`), но не очевидный.

## Что сделать

### Fix 1 — exists key-presence semantics

`assertions.ts:checkRule` — изменить:
```ts
const doesExist = actual !== undefined;  // было: && actual !== null
```

`exists: true` теперь = "ключ присутствует в ответе". `exists: false` = "ключ отсутствует". Для проверки "не null" использовать `not_equals: null` или `type` (которое теперь поддерживает null).

### Fix 2 — type: "null"

- `parser/schema.ts` AssertionRule schema: добавить `"null"` в enum.
- `parser/types.ts` AssertionRule.type union: добавить `"null"`.
- `assertions.ts:checkType`: добавить case `"null": return value === null;`.

### Fix 3 — workaround доc

Не патчим parser, документируем в ZOND.md:

```yaml
# Если в response есть поле с именем type:
expect:
  body:
    "user.type": { equals: "admin" }   # quoted dot-notation
```

## Acceptance

- `exists: true` на `null`-значении в ответе → assertion passes.
- `type: "null"` принимается схемой и проходит на null-значении.
- Тесты покрывают все три сценария + back-compat для существующих exists-проверок.
- ZOND.md документирует dot-notation workaround для конфликтных имён полей.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 exists: true проходит на null-значении (key-presence semantics)
- [x] #2 type: 'null' принимается схемой и проходит на null
- [x] #3 ZOND.md документирует семантику + dot-notation workaround
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/runner/assertions.ts`:**
- `checkRule.exists` теперь использует key-presence: `actual !== undefined` (без `&& actual !== null`). Соответствует JSON-семантике: ключ есть в ответе → exists=true, независимо от значения.
- `checkType` получил case `"null": return value === null;`.

**`src/core/parser/schema.ts` + `parser/types.ts`:**
- `AssertionRule.type` enum расширен на `"null"`.

**Workaround для конфликта имён (Fix 3):**
Не патчили parser. `flattenBodyAssertions` уже корректно обрабатывает quoted dot-notation: `"user.type": { equals: "admin" }` → result["user.type"] = { equals: "admin" } → `getByPath(body, "user.type")` → проверка значения. Документировал в ZOND.md как первоклассный способ для конфликтных имён.

**Тесты:**
- `tests/runner/assertions.test.ts` — 6 новых:
  - exists: true на null → passes (key present)
  - exists: false на null → fails (key still present)
  - type: null на null → passes
  - type: null на non-null → fails
  - type: null на missing key → fails
  - type: object на null → fails (regression check, null is not object)

**ZOND.md** — раздел Assertions расширен:
- Перечислены все 7 type-значений (включая "null").
- Объяснена exists key-presence семантика и комбинация `{ exists: true, not_equals: null }` для "present and non-null".
- Documented quoted dot-notation workaround для полей с reserved-именами (`type`, `equals`, `length`).

**Решения:**
- exists-semantics-change назван "fix not feature change" — старое поведение (`actual !== null`) конфликтовало с JSON и не позволяло отличить "absent" от "null". Это явно улучшение, не breaking change.
- type: "null" не делает type-array (например `["string", "null"]` для nullable полей). Если понадобится — отдельный тикет на nullable types.
- Lowercase-bug в substitution не воспроизводится (см. T34 notes).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three assertion-engine fixes из live-сессии:

**Изменения:**
- `exists: true` теперь key-presence (null counts as exists). Раньше null трактовался как missing.
- `type: "null"` поддерживается в schema enum + checkType.
- ZOND.md документирует:
  - Все 7 type-значений (string|integer|number|boolean|array|object|null)
  - Семантика exists и комбинация для "present non-null"
  - Quoted dot-notation для полей с reserved-именами

**Файлы:**
- `src/core/runner/assertions.ts` — exists fix + null type case
- `src/core/parser/schema.ts` + `types.ts` — type enum extended
- `ZOND.md` — Assertions section expanded
- Тесты: assertions (+6)

**Тесты:** 681/681 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
