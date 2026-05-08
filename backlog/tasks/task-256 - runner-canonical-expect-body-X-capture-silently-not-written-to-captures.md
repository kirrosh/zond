---
id: TASK-256
title: 'runner: canonical `expect.body.<path>.capture: var` молча не пишет в step.captures (CRUD chain ломается)'
status: Done
assignee: []
created_date: '2026-05-08 14:30'
updated_date: '2026-05-08 16:00'
labels:
  - feedback-loop
  - api-sentry
  - runner
  - capture
dependencies:
  - TASK-247
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F2, class definitely_bug.

После TASK-247 top-level `expect.capture: {...}` отвергается с ошибкой, и canonical форма — `expect.body.<path>.capture: var`. Parser её принимает, тест проходит, но в JSON-envelope `step.captures` остаётся пустым `{}`. Captured-id не доступен последующим шагам chain → `{{my_id}}` в URL остаётся undefined → DELETE-step не отправляется (http=null).

Repro:
```
cat > /tmp/_cap.yaml <<'EOF'
name: cap
base_url: x
tests:
  - name: t
    POST: ...
    json: {...}
    expect:
      status: [200,201]
      body:
        id:
          capture: my_id
EOF
zond validate /tmp/_cap.yaml      # OK после TASK-247
zond run /tmp/_cap.yaml --report json --report-out /tmp/x.json
jq '.[].steps[].captures' /tmp/x.json   # → {} (пусто)
```

Реальный пример: `_chase-90.yaml` test "re-create project rule" → 200 OK, следующий test "DELETE project rule" → http=null, потому что URL substitution `{{rule_id}}` failed. Пришлось хардкодить `rule_id=17026746` руками после run.

Impact: блокирует все write-CRUD chains (POST→capture id→DELETE/PUT). После TASK-247 это **единственный** документированный путь — и он не работает.

Log: /tmp/c90.json (re-create project rule + DELETE project rule).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `expect.body.<path>.capture: var` записывает значение в `step.captures[var]` — работало уже после TASK-247 (parser flatten + extractCaptures), покрыто новыми тестами.
- [x] Captured value доступен следующим тестам chain как `{{var}}` в URL/body/headers (через `Object.assign(variables, captures)`).
- [x] Покрыт unit-тестом: nested capture (`body.id`) + deep (`body.data[0].id` и `body.data.0.id`) в `tests/runner/assertions.test.ts`.
- [x] Если captured ничего не нашёл (path miss) → auxiliary failed assertion в step.assertions, step падает с явным сообщением `capture <var>: body '<path>' present` вместо silent `captures: {}`. Реализовано через `findMissedCaptures` + `buildMissedCaptureAssertions`.
- [x] `getByPath` поддерживает bracket-notation (`data[0].id` ≡ `data.0.id`) — раньше только dotted.
- [ ] ~~Verify _chase-90.yaml~~ — runtime-сценарий, проверится в следующем feedback-раунде. Reproducible миник на httpbin.org показал ожидаемое: shape `{a:1}` → `id` отсутствует → step fail с auxiliary assertion → DELETE skip "Depends on missing capture: rule_id".
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- Корневой бажный кейс был не "не пишет", а **silent path-miss**: `extractCaptures` молча пропускал capture-rule, у которого `getByPath` вернул `undefined`. На реальных API (Sentry, Resend) это происходит когда поле в response-body не совпадает с ожидаемым именем (e.g. `{data: {id}}` vs `{id}`) — пользователь видит `captures: {}` без объяснения.
- Решение: новая функция `findMissedCaptures` (`src/core/runner/assertions.ts`) — возвращает массив `{var, source, path}` для каждого пропуска. Executor превращает их в `auxiliary` failed assertion через `buildMissedCaptureAssertions`. Step становится fail, downstream шаги корректно скипаются через существующий missingCaptures-механизм.
- Бонус: расширил `getByPath` (`src/core/utils.ts`) — `[N]` теперь нормализуется в `.N`, чтобы пользователи могли писать естественный JSONPath-стиль `data[0].id`.
- Поведение для retry_until-блока: тоже пушит auxiliary-assertion, но retry-loop сам решит, фейл это или нет (через condition).
<!-- SECTION:NOTES:END -->
