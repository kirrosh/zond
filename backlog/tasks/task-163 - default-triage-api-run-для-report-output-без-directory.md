---
id: TASK-163
title: default triage/<api>/<run>/ для report --output без directory
status: To Do
assignee: []
created_date: '2026-05-06 06:39'
labels:
  - lifecycle
  - report
  - convention
  - ux
dependencies: []
milestone: m-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P7.

Пользователь сам завёл `triage/` руками. zond'у про неё ничего не
известно — все `--output` без префикса попадают в `cwd`. Нет
конвенции «куда складывать триаж-отчёты».

## Что сделать

1. **Дефолтный путь.** Если `--output` не указан — класть в:
   ```
   <workspace>/triage/<api>/<run-id>/<command>-<timestamp>.{md,html}
   ```
   Пример: `triage/sentry/run-12/security-digest-20260506-1430.md`.
2. **Если `--output` без `/`** (только filename) — тоже класть в
   `triage/<api>/<run>/`, использовать filename как basename.
3. **Если `--output` абсолютный/относительный путь с директорией** —
   уважать как сейчас.
4. Stdout: `Wrote triage/sentry/run-12/security-digest-...md`.
5. Регистрировать в manifest (TASK-156) для `zond clean`.

Эффект: rotated-history появляется бесплатно, юзеру не надо
думать о конвенциях.

## Acceptance Criteria

- [ ] `zond report digest <run-id>` без `--output` пишет в `triage/<api>/<run>/digest-<ts>.md`.
- [ ] `zond report case-study <run-id>` аналогично.
- [ ] HTML-export тоже по этой конвенции.
- [ ] Существующее `--output path/file.md` поведение не меняется.
- [ ] Skill update — упомянуть `triage/` как канонический путь.
<!-- SECTION:DESCRIPTION:END -->
