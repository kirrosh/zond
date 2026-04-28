---
id: TASK-HIGH.1
title: 'Reporter: highlight 5xx responses in probe runs'
status: To Do
assignee: []
created_date: '2026-04-28 06:42'
labels:
  - reporter
  - bug-hunting
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Когда tests из probe-validation suite падают из-за 5xx, reporter (console + json) должен явно подсвечивать count 5xx-failures отдельно от обычных assertion-failures — это и есть главный сигнал bug-hunting прогона. Сейчас 5xx считается обычным fail. Тривиальная доработка console reporter + json envelope.
<!-- SECTION:DESCRIPTION:END -->
