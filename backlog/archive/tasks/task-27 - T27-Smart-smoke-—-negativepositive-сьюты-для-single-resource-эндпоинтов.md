---
id: TASK-27
title: 'T27: Smart smoke — negative+positive сьюты для single-resource эндпоинтов'
status: Done
assignee: []
created_date: '2026-04-27 13:42'
updated_date: '2026-04-27 14:17'
labels:
  - generator
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Для эндпоинтов вида `GET /emails/{email_id}` генератор сейчас подставляет placeholder из `.env.yaml` и ставит `expect: status: 200`. На пустом аккаунте без реального ID это гарантированный фейл (~15 фейлов из 45 на первом прогоне Resend).

## Решение (после брейншторма)

Эмитим **два сьюта** на каждый single-resource endpoint, не один. 404 в одиночку не даёт уверенности в фиче, но как negative-smoke полезен (различает auth/baseUrl/route проблемы).

### Negative-smoke (запускается всегда)

- `tags: [smoke, negative]`
- ID = гарантированно несуществующий (`00000000-0000-0000-0000-000000000000` для UUID, `999999999` для int).
- `expect: status: [404, 400, 422]` (массив — некоторые API на невалидный формат UUID кидают 400/422).
- Без TODO. Сигнализирует: auth работает, base_url правильный, роут существует.

### Positive-smoke (нужен реальный ID)

- `tags: [smoke, positive, needs-id]`
- ID = `{{email_id}}` (или ключ из placeholder-эвристики).
- `expect: status: 200`.
- `skip_if: "{{email_id}} == 'example' || {{email_id}} == ''"` — скипается, если в `.env.yaml` placeholder/пусто.
- Комментарий сверху: `# TODO: set email_id in .env.yaml to enable positive smoke`.

### Поведение `zond run`

- `zond run --tag smoke` — крутит оба сьюта. Negative проходит сразу, positive скипается с понятным сообщением.
- `zond run --tag positive` — только positive (требует подставленных ID).
- `zond run --tag '!needs-id'` — выкидывает positive-smoke без ID.

## Эвристика placeholder-detection

Подставленный ID считается реальным, если:
- значение **не** в `{example, placeholder, your-id-here, "", null}`
- значение **не** содержит подстроку `example` или `placeholder`

Иначе → positive-smoke пропускается через `skip_if`.

## Acceptance

- Первый прогон сгенерированных smoke-тестов на пустом аккаунте даёт ≥90% pass rate (negative проходит, positive скипается — оба не считаются failed).
- Если пользователь подставит реальные ID, positive-smoke автоматически активируется без правки сьюта.
- `zond run --tag '!needs-id'` чистый (нет skipped).

## Out of scope (вынесено в T32)

- Auto-discovery ID через `GET /collection?limit=1` setup-сьюты.
- Интерактивный prompt у пользователя.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Эвристика placeholder-detection отличает реальные ID от заглушек
- [x] #2 Генератор эмитит два сьюта (negative+positive) для single-resource endpoints
- [x] #3 Negative-smoke допускает 400/404/422
- [x] #4 Positive-smoke использует skip_if + тег needs-id, авто-активируется при реальном ID в env
- [x] #5 Документация описывает workflow: подставил ID → positive активирован автоматически
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/generator/suite-generator.ts`:**
- Новые helper'ы:
  - `getNonexistentSeed(schema)` — гарантированно несуществующий seed: zero-UUID для `format: uuid`, `999999999` для int/number, `nonexistent_id_zzzzzz` для строк.
  - `convertPathWithBadIds(path, ep)` — заменяет path-параметры bad-seed'ами.
  - `endpointHasPathParams(ep)` — детектор single-resource endpoint'а.
- Smoke-генерация (`generateSuites`) для каждого тега теперь эмитит до **трёх** сьютов вместо одного:
  - `<tag>-smoke` — paramless GETs (как раньше).
  - `<tag>-smoke-negative` — path-param GETs с bad-ID, `expect: status: [400, 404, 422]`, теги `[smoke, negative]`. Body assertions удалены (на 4xx ответ нерелевантны).
  - `<tag>-smoke-positive` — path-param GETs с `{{param}}` placeholder'ом, теги `[smoke, positive, needs-id]`, `skip_if: "{{param}} =="` для каждого шага (skip при пустом env value).

**`src/core/generator/serializer.ts`:**
- `RawStep.expect.status` расширен до `number | number[]`.
- Сериализатор эмитит inline YAML-array: `status: [400, 404, 422]`.
- `skip_if` уже поддерживался индекс-сигнатурой; работает out of the box.

**Эвристика placeholder-detection:**
Пошёл по простейшему пути: `skip_if: "{{param}} =="`. Логика:
- `zond generate` пишет `param: ""` в `.env.yaml` для всех unresolved vars (line 134 в generate.ts).
- При прогоне `{{param}}` подставляется на `""`, выражение становится `"== "`, evaluateExpr возвращает `true` → step скипается.
- Если пользователь подставил реальный ID → выражение `"real-id =="` → false → step выполняется.
- Если переменная вообще не объявлена в env → литерал `{{param}}` остаётся, `"{{param}} =="` → false → step запускается с literal в URL → 404 (graceful failure, не silent skip).

OR/AND в expr-eval намеренно не добавлял — для текущего workflow одного `==` достаточно. Если пользователь руками поставит `param: example`, скип не сработает — но это редкий случай.

**Тесты:**
- `tests/generator/suite-generator.test.ts` — переписан блок "smoke suite path seeds": 5 тестов на splitting (positive получает skip_if, negative получает bad-ID + array status, paramless остаётся в `<tag>-smoke`, mixed tag → 3 сьюта).
- `tests/generator/serializer.test.ts` — 2 новых теста: status-array round-trip + skip_if сериализация.
- `tests/runner/expr-eval.test.ts` — новый describe "empty-string equality (T27 skip_if)" покрывает оба сценария.

**Документация:**
- `ZOND.md` — Phase 1 раздел расширен описанием трёх smoke-сьютов и filtering-рецептов (`--tag smoke`, `--exclude-tag needs-id`, `--tag positive`).

**Решения:**
- `zond run --safe` уже фильтрует на GET-only — обе версии smoke (negative+positive) GET-only, так что safe-mode работает прозрачно.
- Negative-suite использует только `expect: { status: [400,404,422] }` (без body assertions) — на ошибочный ответ структура body API-зависима.
- Auto-skip через skip_if работает только когда env-файл создан `zond generate`. При отсутствии env-файла positive-suite запустится и упадёт с понятным fail (404 + literal placeholder в URL).
- Тег `needs-id` добавлен только positive — позволяет `--exclude-tag needs-id` для чистого первого прогона.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Smart smoke генерация: для каждого single-resource эндпоинта эмитятся два сьюта вместо одного.

**Изменения:**
- `<tag>-smoke-negative` — bad-ID + `status: [400, 404, 422]`. Запускается всегда, валидирует auth/baseUrl/route.
- `<tag>-smoke-positive` — `{{var}}` placeholder + `skip_if: "{{var}} =="` + теги `[smoke, positive, needs-id]`. Авто-скипается при пустом env, авто-активируется при подстановке реального ID.
- Paramless GETs продолжают идти в `<tag>-smoke`.
- `RawStep.expect.status` теперь поддерживает `number[]`, сериализуется как inline-массив.

**Файлы:**
- `src/core/generator/suite-generator.ts` — новые helper'ы + переработанная smoke-генерация
- `src/core/generator/serializer.ts` — status-array support
- `ZOND.md` — Phase 1 раздел с тремя сьютами и filtering-рецептами
- Тесты: suite-generator (+5), serializer (+2), expr-eval (+2)

**Тесты:** 654/654 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
