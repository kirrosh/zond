---
id: ARV-174
title: 'parity: schemathesis V4 baseline run — Sentry/Stripe/Resend + diff bucketing'
status: Done
assignee: []
created_date: '2026-05-12 13:26'
updated_date: '2026-05-13 11:24'
labels:
  - m-18
  - parity
  - benchmark
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Главный блок m-18 (D). Прогнать schemathesis V4 (`--stateful=links --checks all`)
на тех же spec'ах + token'ах, что использует zond, на трёх настроенных API\nв `~/Projects/zond-test/apis/{sentry,stripe,resend}/`. Получить diff zond findings\nvs schemathesis findings: три bucket'а `zond-only / schemathesis-only / both`.\n\nSchemathesis-only классифицировать на три категории:\n- (a) fuzz-генерация (boundary/edge-case)\n- (b) stateful links (multi-call invariants)\n- (c) checks которых нет у zond\n\n## Результат\n\n- `tests/integration/parity/run-schemathesis.sh` — bench-скрипт (не permanent feature)\n- `tests/integration/parity/diff.ts` — diff-логика + классификатор schemathesis-only\n- `backlog/notes/m-18-parity-baseline.md` — таблица результатов по трём API\n\n## Что НЕ делать\n\n- Не имплементить fuzz-engine. m-18 = измерение, не догон.\n- Не «всасывать» (a)/(b) — это сигналы для m-19/m-20, не для этой задачи.\n- Категория (c) → отдельные точечные ARV-задачи внутри 12 checks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 schemathesis V4 запускается на Sentry/Stripe/Resend, отчёт сохраняется в ~/Projects/zond-test/.fb-loop/parity/<api>/
- [ ] #2 diff-скрипт выдаёт три bucket'а с правильной классификацией schemathesis-only на (a)/(b)/(c)
- [ ] #3 backlog/notes/m-18-parity-baseline.md содержит таблицу по трём API + список (c)-кандидатов
<!-- AC:END -->
