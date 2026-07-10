---
id: ARV-409
title: >-
  checks: coverage --union session returns zero-runs when only checks run
  executed (no zond run)
status: To Do
assignee: []
created_date: '2026-07-10 08:25'
updated_date: '2026-07-10 09:46'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MF1 из github run#1 (m-28). zond coverage --api X --union session падает 'No runs match session — coverage cannot be computed against zero runs', хотя depth checks коснулись 625 операций в сессии. Ожидание (ARV-265): audit_coverage считает любой HTTP-touch из checks run/probe/request, не только zond run. Для read-only/checks-only сканов coverage недоступен. Repro: checks run depth+stateful в сессии, без zond run, затем coverage --union session. Evidence: zond-runs/github-run1-20260710/raw/70-coverage.json
<!-- SECTION:DESCRIPTION:END -->
