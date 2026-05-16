---
id: ARV-258
title: 'code: unify report/output channel (reporter slot)'
status: To Do
assignee: []
created_date: '2026-05-16 07:28'
labels:
  - refactor
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После m-21 (категоризация отчёта на security/reliability/contract/hygiene) добавилось ещё inline-логики в reporters. В commands/checks.ts, commands/probe.ts, commands/run.ts разные --report/--output/--report-out семантики. Старый refactor-plan §1 предлагал core/output/ с типизированным OutputSpec<Payload> — после m-21 предложение становится ещё актуальнее. Cost: 3-5 дней. Trigger: следующий drift в reporting'е или m-22+ новые форматы. Выявлено в validation-спринте 2026-05-16.
<!-- SECTION:DESCRIPTION:END -->
