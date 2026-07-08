---
id: ARV-258
title: 'code: unify report/output channel (reporter slot)'
status: To Do
assignee: []
created_date: '2026-05-16 07:28'
updated_date: '2026-05-18 13:02'
labels:
  - refactor
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После m-21 (категоризация отчёта на security/reliability/contract/hygiene) добавилось ещё inline-логики в reporters. В commands/checks.ts, commands/probe.ts, commands/run.ts разные --report/--output/--report-out семантики. Старый refactor-plan §1 предлагал core/output/ с типизированным OutputSpec<Payload> — после m-21 предложение становится ещё актуальнее. Cost: 3-5 дней. Trigger: следующий drift в reporting'е или m-22+ новые форматы. Выявлено в validation-спринте 2026-05-16.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Downgraded to LOW (2026-05-16 strategy review): trigger condition 'next drift in reporting' has not occurred; m-22 has not introduced new formats. Re-raise when next reporter drift surfaces.
<!-- SECTION:NOTES:END -->
