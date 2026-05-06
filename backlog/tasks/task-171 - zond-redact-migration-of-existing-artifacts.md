---
id: TASK-171
title: 'zond redact: миграция существующих artifacts (db + triage/)'
status: To Do
assignee: []
created_date: '2026-05-06 06:55'
labels:
  - redaction
  - migration
  - clean
dependencies:
  - TASK-166
  - TASK-170
milestone: m-10
priority: low
---

## Description

## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), «Что делать с уже накопленным».

После включения redaction (TASK-167 + TASK-168) все НОВЫЕ артефакты
чисты. Но в существующих воркспейсах токены уже размазаны по:

- `zond.db` (results.request_url/body, response_body/headers, error_message)
- `triage/*.html`, `triage/*.md`, `triage/*.json`
- `tests/` если кто-то вручную копировал curl-output'ы

Команда `zond redact` использует SecretRegistry (заполненный из
`.secrets.yaml` / `${ENV}`) для перезаписи существующих файлов.

Зависит от TASK-166 (registry), TASK-170 (.secrets.yaml — источник
значений). Без них registry пустой.

## Что сделать

1. **`zond redact --since <run-id>`** — пройтись по results, начиная
   с run-id, переписать поля через `registry.redact()`. UPDATE, не
   DELETE/RECREATE.
2. **`zond redact <path>`** — рекурсивно обработать `.html/.md/.json/.yaml`
   в директории. Backup в `<path>.bak` (или флаг `--no-backup`).
3. **`zond redact --all`** — db + workspace `triage/` за один проход.
4. **`--dry-run`** (по дефолту) — показать что заменится, не писать.
5. **`--force`** — реально записать.
6. **Stdout-отчёт:** «12 substitutions in zond.db (run #8-13), 5 files
   in triage/, 0 secrets found in tests/».
7. **Edge case:** если registry пуст — отказ с подсказкой («load
   `.secrets.yaml` first, or use --pattern <regex>»).
8. **`--pattern <regex>`** (опционально) — для редких случаев,
   когда секрет не в registry, но известен regex (`sntryu_[a-f0-9]+`).

## Acceptance Criteria

- [ ] `zond redact --since <run-id> --dry-run` показывает кол-во замен без записи.
- [ ] `zond redact --since <run-id> --force` реально переписывает results в БД.
- [ ] `zond redact <path>` обрабатывает .html/.md/.json в директории.
- [ ] Backup создаётся, кроме `--no-backup`.
- [ ] Stdout-отчёт по результатам.
- [ ] `--all` объединяет db + triage/.
- [ ] Без registry — fail-loud с подсказкой.
