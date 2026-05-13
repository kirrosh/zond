# parity — schemathesis V4 ↔ zond benchmark (m-18)

Одноразовые bench-скрипты для замера gap'а между zond и schemathesis V4
на одних и тех же API. **Не permanent feature** — это measurement-tooling
для milestone m-18 (см. `backlog/milestones/m-18`).

## Структура

- `run-schemathesis.sh <api> [--smoke|--full]` — запуск schemathesis на
  `~/Projects/zond-test/apis/<api>/spec.json` с auth_token из
  `.secrets.yaml`. Отчёт в `~/Projects/zond-test/.fb-loop/parity/<api>/`.
- `diff.ts` — diff zond findings (из zond.db через `zond db`) vs
  schemathesis findings (ndjson). Три bucket'а: `zond-only`,
  `schemathesis-only`, `both`.

## Зачем

ARV-174 (m-18 D-блок): получить количественный ответ на «догонять ли
schemathesis по fuzz-engine», и классифицировать `schemathesis-only`
findings на (a) fuzz / (b) stateful / (c) missing checks.

Только bucket (c) — кандидат на «всосать в zond» в рамках m-18.

## Quickstart

```bash
# Smoke (5-10 endpoints, ~2 минуты, low rate-limit risk):
./run-schemathesis.sh sentry --smoke

# Full (все endpoints, 30+ минут):
./run-schemathesis.sh sentry --full

# Diff (после того как у тебя есть свежий zond run и schemathesis report):
bun diff.ts --api sentry --zond-run latest --schemathesis-report ~/Projects/zond-test/.fb-loop/parity/sentry/schemathesis-latest.ndjson
```
