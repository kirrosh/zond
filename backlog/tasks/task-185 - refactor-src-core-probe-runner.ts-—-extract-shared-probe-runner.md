---
id: TASK-185
title: 'refactor: src/core/probe/runner.ts — extract shared probe runner'
status: To Do
assignee: []
created_date: '2026-05-07 06:49'
labels:
  - refactor
  - probe
milestone: m-11
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
70% кода переиспользуется между probe-validation/methods/mass-assignment/security: HTTP-клиент, capture, redaction-pipeline, console+json reporter, env-resolution. Сейчас shared-куски размазаны по src/core/probe/* + дублируются в каждой команде. Цель — модуль ProbeRunner с явным интерфейсом (Probe interface: name, plan(), execute(step), report()), а каждая probe-команда — тонкий вызов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/probe/runner.ts реализует ProbeRunner и интерфейс Probe
- [ ] #2 Каждая из 4 probe-* команд переписана на ProbeRunner
- [ ] #3 Дублирующийся код удалён (грубо: -300..-500 строк суммарно)
- [ ] #4 tests/integration probe-* зелёные без изменений в expected-output
<!-- AC:END -->
