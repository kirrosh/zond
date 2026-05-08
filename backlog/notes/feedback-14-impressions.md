# Feedback-14 — full audit (Sentry, after TASK-249/271/273/274/275)

Saved 2026-05-08. Сессия: полный аудит, итог 100% hit / 34% honest passing-2xx (219/219, 74/219).

## Findings (Sentry-side, для отдельного отчёта)
- 1 SSRF (release.url) + 4 CRLF (name-fields) — найдено `probe security`.
- 17 групп 5xx unhandled (~60 уникальных запросов): bad path-id → 500, bulk PUT → 502, integer overflow → 500.
- 6 schema drifts (POST 201→200, sessions/scim trailing slash, PUT teams 404, null vs typed).
- 714 OpenAPI lint issues (399 HIGH).

## Что в zond подтверждённо хорошо
1. `probe security` — нашёл реальный SSRF за 30с. Flagship.
2. probe-validation (через сгенерированные probes) — систематически ловит 5xx на bad path-id. Без него ~60 крашей не нашли бы.
3. `lint-spec` — статический анализ до HTTP. Полезен.
4. `coverage --union session` (TASK-255) — единственный способ увидеть hit-coverage, без неё работа выглядит как 30% honest и демотивирует.

## Затыки этого раунда → tasks

1. F1. probe mass-assignment ложно классифицирует **5xx-baseline** как HIGH privilege-escalation (4 endpoints). TASK-91 закрыл 4xx-baseline, но 5xx → новая ветка. → **TASK-276**.
2. F2. `--validate-schema` пишет `[object Object]` вместо имени required-поля в reporter'е (`expected schema.required but got [object Object]`). → **TASK-277**.
3. F5. `probe security` оставляет orphan resources после cleanup-failure: «4 orphan(s)» без id/URL. → **TASK-278** (list ids + `zond cleanup --orphans`).
4. F6. `lint-spec` — стена из 714 строк, 399 HIGH из них один rule × 385 случаев. Нет grouping by rule + severity-filter. → **TASK-279**.
5. F8. `coverage --json --union session` — нет отдельного списка `covered2xxEndpoints` (только `coveredEndpoints` 172 + `partialEndpoints` 47, семантика непрозрачна и расходится с не-JSON выводом). → **TASK-280**.
6. F9. `discover --apply` skip-already-set даже если existing fixture-id давно протух (probe-security удалил ресурс). Нет `--verify`/`--refresh`. → **TASK-281**.
7. `run --learn` — при passing-test-but-wrong-status (например, 200 вместо spec'овых 201) предлагать обновить spec/тест точечно. → **TASK-282**.

## TL;DR по продукту
- Все классы команд испробованы (init, discover, bootstrap, generate, run, coverage --union, db diagnose, lint-spec, probe-validation, probe-methods, probe-mass-assignment, probe security, --validate-schema). Surface достаточен.
- Чтобы поднять honest-coverage > 80%, нужен **warm-up workspace** (test event → issue_id, sourcemap → file_id, slack-integration → integration_id, replay через SDK) — это вне zond, но кандидат на skill «warm up target».
- F3/F4 переподтверждают TASK-273/271; mass-assignment FA-issue (F1) — единственный security-инжeneer-blocker класса «час потерянного времени».
