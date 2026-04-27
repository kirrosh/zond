---
id: TASK-34
title: 'T34: Fail-loud на unknown {{$generator}} + fix lowercase bug'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 15:27'
updated_date: '2026-04-27 15:36'
labels:
  - runner
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Если `{{$randomFqdn}}` (или любой helper) не зарегистрирован в `GENERATORS`, runner отправляет literal `"{{$randomFqdn}}"` в API. Это silent failure: тест получает 422/400 без понятной диагностики.

Дополнительно обнаружен баг: при подстановке `{{$randomFqdn}}` в один из сценариев имя становится lowercase (`{{$randomfqdn}}`). Нужно проверить регистр-неагрессивность substituter'а.

## Что сделать

1. **`src/core/parser/variables.ts:substituteString`** — если ключ начинается с `$` и не найден ни в `vars`, ни в `GENERATORS` → бросить `Error("Unknown generator: $foo. Available: $uuid, $randomString, …")`.
2. **`src/core/runner/executor.ts`** — поймать эту ошибку в step execution, превратить в `status: "error"` с понятным `error` сообщением (не падать всей suite).
3. Воспроизвести и пофиксить lowercase-bug — найти где именно теряется регистр (вероятно в `extractMethodAndPath` или в YAML-парсинге).
4. Тесты:
   - Unknown `{{$foo}}` в YAML → step фейлится с ясной ошибкой.
   - Регистр сохраняется: `{{$randomFqdn}}` остаётся `randomFqdn`, не `randomfqdn`.

## Acceptance

- Опечатка в helper-имени даёт `error: "Unknown generator: $randomfqdn (did you mean $randomFqdn?)"` вместо литералки в URL/body.
- Регистр в helper-именах не теряется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 substituteString бросает ошибку на неизвестный {{$generator}}, с подсказкой 'did you mean'
- [x] #2 Executor ловит эту ошибку и превращает в step error, не валит всю suite
- [x] #3 Зависимые шаги cascade-skipятся по missing capture
- [x] #4 Не-$ unknown vars продолжают проходить как literal (совместимость)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/parser/variables.ts:substituteString`:**
- Добавлены helper-функции `suggestGenerator(name)` и `unknownGeneratorError(key)`.
- `suggestGenerator` ищет через case-insensitive exact match (для опечаток только в регистре) → prefix match (первые 6 символов).
- При попадании в template ключа `$xxx`, которого нет ни в `vars`, ни в `GENERATORS` → бросается `Error("Unknown generator: {{$xxx}} (did you mean $X?). Available: $uuid, $randomString, …")`.
- Не-`$` префиксы (обычные пользовательские переменные) продолжают вести себя как раньше — возвращаются как literal.
- User-defined `$customKey` в env переменных всё ещё работает (vars-look-up идёт первым).

**`src/core/runner/executor.ts`:**
- Substitute-операции (`set`, `substituteStep`, `substituteString` для base_url, `substituteDeep` для headers) обёрнуты в `try/catch`.
- При выбросе ошибки шаг помечается `status: "error"` с понятным `error` сообщением.
- Captures из `expect.body` помечаются как `failedCaptures` — зависимые шаги корректно скипаются с reason "Depends on missing capture: ...".

**Lowercase-bug** воспроизвести **не удалось** — проверил substituteString напрямую, через embedded substitution и через YAML-парсинг → регистр сохраняется во всех путях. Скорее всего lowercase произошёл в pipeline пользователя (AI-агент Claude Code мог нормализовать имя ключа при правке файла), а не в zond. Здесь чинить нечего.

**Тесты:**
- `tests/parser/variables.test.ts` — новый describe "T34 fail-loud" (5 кейсов): unknown в full match, unknown в embedded, case-only typo с suggestion, не-`$` literal сохраняется, user-defined `$customKey` в env работает.
- `tests/runner/executor.test.ts` — 3 кейса: unknown $generator → step error, case-only typo → suggestion, cascade-skip dependent step on missing capture.

**Решения:**
- Решил выбрасывать только на `$`-префиксированные ключи. Не-`$` (обычные user vars) продолжают возвращать literal — это back-compat с существующим поведением, где `{{undefined_var}}` намеренно проходит как литерал (некоторые сценарии полагаются на это).
- Suggestion алгоритм простой (CI exact + prefix), без Levenshtein — для типичной опечатки в регистре или префиксе достаточно. Можно усложнить если будут жалобы.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fail-loud на неизвестные generator-плейсхолдеры.

**Изменения:**
- `substituteString` бросает `Error("Unknown generator: {{$X}} (did you mean $Y?). Available: ...")` для `$`-префиксированных ключей, отсутствующих в `vars` и `GENERATORS`.
- Suggestion: case-insensitive exact match + prefix match.
- Executor ловит ошибку, превращает в step `error`, не валит всю suite.
- Зависимые шаги cascade-skipятся через failedCaptures.

**Lowercase-bug** в zond не воспроизводится — регистр сохраняется во всех путях substitution. Источник был, вероятно, в pipeline пользователя (Claude Code agent мог нормализовать имя при правке).

**Файлы:**
- `src/core/parser/variables.ts` — suggestGenerator + throw в substituteString
- `src/core/runner/executor.ts` — try/catch вокруг substitute calls
- Тесты: variables (+5), executor (+3)

**Тесты:** 675/675 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
