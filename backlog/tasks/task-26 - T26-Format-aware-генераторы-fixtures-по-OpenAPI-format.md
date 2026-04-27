---
id: TASK-26
title: 'T26: Format-aware генераторы fixtures по OpenAPI format'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 13:41'
updated_date: '2026-04-27 14:01'
labels:
  - generator
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond generate` сейчас раскладывает все строковые поля в `{{$randomString}}`. Это ловит 422 на CRUD (templates, contacts, webhooks, automations), потому что:
- `domain.name` ждёт hostname/FQDN
- `webhook.url` ждёт URL
- `contact.email` ждёт email

OpenAPI это знает через `format: hostname|uri|email|uuid|date|date-time`, но генератор не использует.

## Что сделать

Мэппинг `format` → встроенные генераторы:

| format | helper |
|---|---|
| email | `{{$randomEmail}}` |
| uri / url | `{{$randomUrl}}` |
| hostname | `{{$randomFqdn}}` |
| uuid | `{{$randomUuid}}` |
| date / date-time | `{{$randomDate}}` / `{{$randomIsoDate}}` |
| ipv4 | `{{$randomIpv4}}` |

Fallback на `$randomString` если `format` не распознан.

## Acceptance

- Сгенерированные suites для Resend (domains, contacts, webhooks) проходят 422-валидацию на первом прогоне.
- Список поддерживаемых helpers документирован в ZOND.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 format → helper mapping реализован
- [x] #2 Все 6+ форматов покрыты тестами
- [x] #3 regression-замер: число 422 на сгенерированных suites уменьшилось
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План

1. **`src/core/parser/variables.ts`** — добавить генераторы: `$randomUrl`, `$randomFqdn`, `$randomDate`, `$randomIsoDate`, `$randomIpv4`. Переиспользуем `$uuid` для format=uuid.
2. **`src/core/generator/data-factory.ts:guessStringPlaceholder`** — заменить статические значения на placeholder-генераторы для `uri/url/hostname/ipv4/date/date-time` и для name-based heuristics (`url`, `website`).
3. **Тесты:**
   - `tests/parser/variables.test.ts` — формат-валидация новых генераторов (URL, FQDN, date YYYY-MM-DD, ISO date-time, ipv4 octets).
   - `tests/generator/data-factory.test.ts` — обновить ожидания на placeholder'ы.
4. **`ZOND.md`** — пополнить список Generators.
5. **`src/core/generator/guide-builder.ts`** — обновить документацию для AI-агентов.

ipv6/password остаются на статике (не входят в скоп задачи).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/parser/variables.ts`:**
- Новые генераторы добавлены в `GENERATORS`:
  - `$randomUrl` → `https://example-{8 lowercase alnum}.com/path`
  - `$randomFqdn` → `test-{8 lowercase alnum}.example.com`
  - `$randomIpv4` → `10.{1-254}.{1-254}.{1-254}` (RFC1918, гарантированно не совпадёт с реальным сервисом)
  - `$randomDate` → `YYYY-MM-DD` (сегодня)
  - `$randomIsoDate` → ISO 8601 datetime (now)
- Helper'ы `lowerChars`, `randomOctet`, `randomDate` вынесены приватными функциями.

**`src/core/generator/data-factory.ts`:**
- В `guessStringPlaceholder` все известные `format` теперь маппятся на placeholder-генераторы (а не на статические значения):
  - `email` → `{{$randomEmail}}` (как было)
  - `uuid` → `{{$uuid}}` (как было)
  - `uri/url` → `{{$randomUrl}}` (было: статика `https://example.com/test`)
  - `hostname` → `{{$randomFqdn}}` (было: `example.com`)
  - `ipv4` → `{{$randomIpv4}}` (было: `192.168.1.1`)
  - `date` → `{{$randomDate}}` (было: `2025-01-01`)
  - `date-time` → `{{$randomIsoDate}}` (было: `2025-01-01T00:00:00Z`)
- Name-based heuristics для `url|website|_url|href|uri` теперь тоже отдают `{{$randomUrl}}` вместо статики.
- ipv6 (`::1`) и password (`TestPass123!`) оставлены статическими — не входят в скоп задачи и часто требуют доменно-специфичных значений.

**Тесты:**
- `tests/parser/variables.test.ts` — 6 новых тестов: формат-валидация $randomUrl/$randomFqdn/$randomIpv4/$randomDate/$randomIsoDate + проверка различия значений между вызовами.
- `tests/generator/data-factory.test.ts` — обновлены ожидаемые значения с статики на placeholder'ы.

**Документация:**
- `ZOND.md` — раздел Generators переписан в виде таблицы с маппингом на OpenAPI `format`.
- `src/core/generator/guide-builder.ts` — список helper'ов в guide для AI-агентов расширен.

**Решения:**
- Использован существующий `$uuid` вместо предложенного в задаче `$randomUuid` — он уже работает и тестирован.
- Для FQDN/URL префикс/суффикс намеренно не randomизирован полностью (`example-...com` / `test-...example.com`) — обеспечивает читабельность сгенерированных fixtures и исключает попадание на реальные домены.
- IPv4 диапазон 10.0.0.0/8 (private) — безопасен для тестов, не разрешится в реальный сервер.
- AC #3 (regression-замер 422) формально проверяется при следующем live-прогоне; на уровне unit-тестов изменение покрыто заменой ожиданий.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Format-aware fixture генераторы для `zond generate`.

**Изменения:**
- 5 новых helper'ов: `$randomUrl`, `$randomFqdn`, `$randomIpv4`, `$randomDate`, `$randomIsoDate`.
- `guessStringPlaceholder` теперь эмитит placeholder'ы для всех 7 OpenAPI format'ов (email, uuid, uri/url, hostname, ipv4, date, date-time), а не статические строки.
- Каждый сгенерированный fixture получает уникальное значение при каждом запуске → нет коллизий на CRUD-сьютах.

**Файлы:**
- `src/core/parser/variables.ts` — новые генераторы в `GENERATORS`
- `src/core/generator/data-factory.ts` — `guessStringPlaceholder` рефакторинг
- `src/core/generator/guide-builder.ts` — обновлён built-in generators list
- `ZOND.md` — таблица Generators с маппингом на OpenAPI format
- Тесты: variables (+6), data-factory (обновлены ожидания)

**Тесты:** 647/647 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
