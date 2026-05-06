---
id: TASK-166
title: redaction registry + sanitizer infrastructure
status: Done
assignee: []
created_date: '2026-05-06 06:52'
updated_date: '2026-05-06 09:59'
labels:
  - redaction
  - secrets
  - infra
milestone: m-10
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §3.

Фундамент для всего m-10. Реестр секретных значений в runtime +
единый sanitizer-проход, который умеет заменить любое известное
секретное значение на `<redacted:<var-name>>`.

Пока без интеграции в DB / exporter'ы — это TASK-B / TASK-C.
Здесь только инфраструктура.

## Что сделать

1. **`SecretRegistry` модуль** (новый, например `src/core/secrets/registry.ts`):
   ```ts
   class SecretRegistry {
     register(name: string, value: string): void;
     redact(text: string): string;        // single string
     redactObject<T>(obj: T): T;          // deep clone with replacements
     redactedNames(): string[];           // for diagnostics
   }
   ```
2. **Источники секретов** (только инфраструктура — заполнение в TASK-D/E):
   - явный API `registry.register("auth_token", value)`.
   - hook для будущего `.secrets.yaml` loader'а.
3. **Sanitizer logic:**
   - точные match'и (раз value зарегистрирован — заменяется везде).
   - НЕ heuristic (не угадывать «это похоже на токен»). Только то, что явно зарегистрировано.
   - подстраховка: минимальная длина value (≥ 8 символов), иначе skip — чтобы `auth_token: ""` или `id: 1` случайно не превратили все единицы в `<redacted>`.
4. **`--no-redact` глобальный CLI-флаг** для локального дебага (через context, передаётся в registry; redact-функции возвращают original).
5. **Marker format:** `<redacted:auth_token>` (имя var). Формат документировать в одном месте.
6. **Unit-тесты:** регистрация, redact в string, redact в nested object, no-redact mode, минимальная длина.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Модуль `src/core/secrets/registry.ts` с публичным API.
- [ ] #2 `redact()` корректно заменяет registered values в строках.
- [ ] #3 `redactObject()` рекурсивно обрабатывает nested objects/arrays.
- [ ] #4 `--no-redact` флаг отключает обработку.
- [ ] #5 Unit-тесты покрывают: registration, redact, deep redact, no-redact, edge cases (empty value, very short value).
- [ ] #6 Документирован marker format `<redacted:<name>>`.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/secrets/registry.ts: SecretRegistry class with register/registerAll/redact/redactObject/setEnabled/clear, MIN_SECRET_LENGTH=8 guard, longest-first redaction, marker <redacted:<name>>. Global --no-redact flag wired via preAction hook. 14 unit tests covering registration, deep redact, no-redact mode, edge cases. ZOND.md documents marker format. Foundation for TASK-167/168.
<!-- SECTION:NOTES:END -->
