---
id: ARV-1
title: 'checks: каркас команды zond checks + реестр + JSON envelope'
status: To Do
assignee: []
created_date: '2026-05-09 15:45'
labels:
  - checks
  - m-15
  - depth
  - foundation
dependencies: []
milestone: m-15
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда zond checks list --json возвращает массив всех зарегистрированных checks с id/severity/default_expected/references
- [ ] #2 Команда zond checks run --check NAME запускает только указанный check, --exclude-check скипает
- [ ] #3 JSON envelope соответствует схеме docs/json-schema/checks-run.schema.json
- [ ] #4 Unit-тест tests/core/checks/registry.test.ts: регистрация/селектор/exclude
- [ ] #5 Integration-тест tests/cli/checks/pipeline.test.ts: mock OpenAPI с 3 ops + nock-сервер → checks вызываются на правильных ops
- [ ] #6 Snapshot-тест JSON-shape стабилен
- [ ] #7 exit-code 0 при отсутствии HIGH findings, 1 при наличии
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Новая команда `src/cli/commands/checks.ts`: `zond checks list`, `zond checks run [--check NAME...] [--exclude-check NAME...] [--api X] [--workers N] [--report sarif|json|ndjson] [--phase examples|coverage|all]`.
2. Реестр в `src/core/checks/registry.ts`: `Check { id, severity, defaultExpected, references (CWE/OWASP), applies(operation), run(case, response): CheckResult }`.
3. Pipeline в `src/core/checks/runner.ts`: для каждого operation генерим case через существующий `core/generator/data-factory.ts`, отправляем через `runner/send-request.ts`, прогоняем активные checks, агрегируем findings.
4. Каждый check — изолированный модуль в `src/core/checks/checks/<id>.ts`, ≤80 LOC.
5. Output: унифицированный JSON envelope `{ ok, command:"checks run", data:{ findings:[{check,severity,operation,request_signature,response_summary,recommended_action}], summary }, warnings, errors, exit_code }`.
6. Reuse: уважать глобальный `--api`, `zond.config.yml` дефолты (`--timeout`, `--rate-limit`).
7. `checks list --json` — каталог реестра для tool-discovery агентом.
<!-- SECTION:PLAN:END -->
