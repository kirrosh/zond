---
id: ARV-412
title: >-
  checks: status_code_conformance count inflated by cross-method fuzz (rollup by
  probed method)
status: To Do
assignee: []
created_date: '2026-07-10 08:25'
labels:
  - m-28
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
UX1 из github run#1 (m-28). checks run --phase coverage фаззит каждую операцию многими HTTP-методами; status_code_conformance флагует 'Status 404 not declared for OPTIONS/TRACE/POST' на GET-only эндпоинтах. 1262 findings, из них реальный drift на declared-методе = 164. Raw count читается как '1262 contract drifts'. Fix: by_probed_method rollup в выводе finding'а, или отделять unsupported-method fuzz от declared-method drift, чтобы сигнал был виден без ручного jq.
<!-- SECTION:DESCRIPTION:END -->
