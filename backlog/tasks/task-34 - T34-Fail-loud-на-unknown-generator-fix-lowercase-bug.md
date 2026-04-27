---
id: TASK-34
title: 'T34: Fail-loud на unknown {{$generator}} + fix lowercase bug'
status: To Do
assignee: []
created_date: '2026-04-27 15:27'
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
