---
id: TASK-166
title: redaction registry + sanitizer infrastructure
status: To Do
assignee: []
created_date: '2026-05-06 06:52'
labels:
  - redaction
  - secrets
  - infra
dependencies: []
milestone: m-10
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

- [ ] Модуль `src/core/secrets/registry.ts` с публичным API.
- [ ] `redact()` корректно заменяет registered values в строках.
- [ ] `redactObject()` рекурсивно обрабатывает nested objects/arrays.
- [ ] `--no-redact` флаг отключает обработку.
- [ ] Unit-тесты покрывают: registration, redact, deep redact, no-redact, edge cases (empty value, very short value).
- [ ] Документирован marker format `<redacted:<name>>`.
<!-- SECTION:DESCRIPTION:END -->
