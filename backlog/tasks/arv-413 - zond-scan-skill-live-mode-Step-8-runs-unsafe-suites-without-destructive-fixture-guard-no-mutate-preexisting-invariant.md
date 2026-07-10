---
id: ARV-413
title: >-
  zond-scan skill: live-mode Step 8 runs unsafe suites without
  destructive-fixture guard (no-mutate-preexisting invariant)
status: To Do
assignee: []
created_date: '2026-07-10 09:46'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SD1 из vercel run#2 (m-28). /zond-scan live-ветка Step 8 гоняет ВСЕ suites включая smoke-*-unsafe (см. ARV-новая MF2), без guard'а против мутации пред-существующих ресурсов. Конвенция предполагает sandbox==safe-to-mutate-anything — ложно для API без sandbox (Vercel: спек содержит account-delete/money/security-posture эндпоинты). Субагент обошёл вручную через SAFETY-POLICY.md allowlist. Fix: (a) live-default '--exclude-tag unsafe' в Step 8; (b) first-class 'no-mutate-preexisting' инвариант — мутации только по self-created id, харвест-id из list никогда не удалять. Комплемент к ARV-411 (safe-сторона уже пропатчена skill-guard'ом), это LIVE-сторона.
<!-- SECTION:DESCRIPTION:END -->
