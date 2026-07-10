---
id: ARV-412
title: >-
  generator: smoke-*-unsafe.yaml bind destructive ops to raw .env fixtures with
  no self-create (live = real account deletion)
status: Done
assignee: []
created_date: '2026-07-10 09:46'
updated_date: '2026-07-10 11:52'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MF2 из vercel run#2 (m-28), SAFETY/CRITICAL. zond generate эмитит smoke-*-unsafe.yaml с DELETE /v1/user, PATCH /v2/teams/{{teamId}}, POST /v1/billing/buy — эти шаги бьют по RAW значениям из .env.yaml (teamId, user и т.п.) БЕЗ предшествующего self-create (в отличие от crud-*.yaml, где POST→capture→delete своего id). Наивный 'zond run apis/<api>/tests' в live-режиме = удаление/мутация РЕАЛЬНЫХ ресурсов аккаунта. Единственная защита сейчас — тег 'unsafe' + память оператора. Blast-radius: удаление аккаунта. Fix: destructive-шаги без self-create предка не должны генериться против raw-фикстур; либо hard-gate (unsafe требует explicit opt-in + self-created id). Связано: ARV-15 (separate safe/unsafe output), ARV-411 (safe-scan CRUD guard). Evidence: raw/all-write-endpoints.txt, SAFETY-POLICY.md.
<!-- SECTION:DESCRIPTION:END -->
