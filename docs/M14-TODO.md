# M14: Оставшиеся доработки

## Генератор: пустые body для Record-типов

`data-factory.ts` не генерирует тестовые данные для `Record<string, string>` (additionalProperties). Пример: `PUT /api/environments/:id` получает пустой `json: variables:` → 400.

**Файл:** `src/core/generator/data-factory.ts`
**Фикс:** добавить обработку `additionalProperties` → генерировать `{ "key": "value" }`.

## Skeleton-тесты нерабочие без контекста

Auth, Export, Runs — skeleton suite'ы генерируются с `{{$randomString}}` / `{{$randomInt}}` вместо реальных значений. Эти тесты не могут пройти без ручной доработки:

- `auth.yaml` — проксирует логин к несуществующему серверу
- `export.yaml` — ищет run по случайному ID (404)
- `runs.yaml` — запускает тесты по случайному пути (500)

**Варианты:** исключить эти эндпоинты из генерации (пометить как "internal") или пометить сгенерированные skeleton-тесты как draft/skip.

## Integration test: crud-chain.test.ts

`tests/integration/crud-chain.test.ts` использует `createApp()` напрямую (in-process), не проходит через HTTP. Старые тесты с test-server (`auth-flow.test.ts`) остаются исключёнными из CI.

## CI: typecheck

`tsc --noEmit` по-прежнему отключён. `@hono/zod-openapi` добавляет типы, но конфликт с `test-server/` не решён.
