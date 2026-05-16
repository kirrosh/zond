---
id: ARV-259
title: 'code: anti-FP registry (core/anti-fp/rules)'
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
После ARV-252 (mass-assignment → evidence-chain) и ARV-253 (CRLF → reflection) anti-FP логика частично размазана между probe-классами и checks. core/anti-fp/ существует (bootstrap), но registry-pattern с FpRule[] и явными scope не выстроен. Без него каждый новый probe-class будет переписывать guard'ы локально. Cost: 2-3 дня. Trigger: следующий evidence-chain rewrite (SSRF? rate-limit?). Выявлено в validation-спринте 2026-05-16.
<!-- SECTION:DESCRIPTION:END -->
