---
id: TASK-207
title: >-
  tests: cover security/mass-assignment/negative/method probe missed branches +
  weak fixes
status: Done
assignee: []
created_date: '2026-05-07 10:12'
updated_date: '2026-05-07 12:05'
labels:
  - tests
  - probe
  - coverage
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(1) security-probe: open-redirect end-to-end (только detectFields покрыт), severity 'inconclusive' rollup, multi-class запуск, formatSecurityDigest для low/inconclusive/skipped секций. (2) mass-assignment: 'auth header injected from vars' L528 не проверяет headers (комментарий признаёт) — переписать через installFetchMock с header capture. 'logs restore failure' regex с | разделить на 2 теста. formatDigestMarkdown через literal verdict. (3) negative-probe: invalid-uuid sentinel exact count (export INVALID_UUID_SENTINELS), in:'header'|'cookie' params, non-bearer security schemes. (4) method-probe: keys[0] brittle access — explicit KNOWN_METHODS.find. Path с multiple {x} placeholders.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 security: open-redirect, inconclusive rollup, multi-class — добавлены
- [x] #2 mass-assignment: auth-header переписан через captured headers; restore-failure разделён; formatDigestMarkdown через literal
- [x] #3 negative-probe: header/cookie params, non-bearer auth, exact uuid sentinel count
- [x] #4 method-probe: keys[0] заменено на KNOWN_METHODS.find; multi-{x} path render
- [x] #5 ≥12 новых кейсов суммарно
<!-- AC:END -->
