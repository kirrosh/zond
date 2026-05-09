---
id: TASK-160
title: 'probe-suites DRY: extends/template для общей шапки'
status: To Do
assignee: []
created_date: '2026-05-06 06:38'
labels:
  - lifecycle
  - probe
  - dry
  - size
dependencies: []
milestone: m-14
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P4.

134 validation-probe = 3.7 MB на скромном API. Каждый файл —
~28 KB, потому что в нём 8–14 шагов с полностью повторённой
YAML-шапкой (`name`, `tags`, `base_url`, `headers`, `source`).
DRY бы дал × 5 экономии: 3.7 MB → ~700 KB.

## Что сделать

Два варианта (выбрать один):

1. **`extends:` в YAML.** В каждом probe-suite:
   ```yaml
   extends: ../_template.yaml
   steps:
     - ...
   ```
   `_template.yaml` лежит в `apis/<name>/probes/_template.yaml` или
   `probes/<class>/_template.yaml` и содержит общую шапку.

2. **Inline-merge при чтении.** Runtime читает `_template.yaml` и
   мерджит в каждый suite перед выполнением. Юзер видит мелкие
   файлы; tools (zond run) автоматически разрешают template.

Рекомендация: вариант 1 (явный `extends:`) — читается без знания
руntime-логики.

## Acceptance Criteria

- [ ] Probe-emit использует `extends:` или inline-merge для общей шапки.
- [ ] `zond run` корректно резолвит `extends:`.
- [ ] Размер `apis/sentry/probes/validation/` падает в ≥ 3 раза на том же контенте.
- [ ] Существующие suites без `extends:` продолжают работать (backward compat).
- [ ] Документация: формат `extends:` и порядок merge.
<!-- SECTION:DESCRIPTION:END -->
