---
id: TASK-256
title: 'runner: canonical `expect.body.<path>.capture: var` молча не пишет в step.captures (CRUD chain ломается)'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
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
- [ ] `expect.body.<path>.capture: var` записывает значение в `step.captures[var]`.
- [ ] Captured value доступен следующим тестам chain как `{{var}}` в URL/body/headers.
- [ ] Покрыт unit-тестом: один nested capture (`expect.body.id.capture`), один deep (`expect.body.data[0].id.capture`).
- [ ] Verify: запустить `_chase-90.yaml` без хардкода `rule_id` → DELETE step реально шлёт HTTP, статус 204/404 (не http=null).
- [ ] Если captured ничего не нашёл (path miss) → step warning, не silent {}.
<!-- SECTION:ACCEPTANCE:END -->
