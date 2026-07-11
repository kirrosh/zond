---
id: ARV-415
title: >-
  checks run --phase coverage creates resources (edge-config) without cleanup,
  unlike probes
status: Done
assignee: []
created_date: '2026-07-10 09:46'
updated_date: '2026-07-10 11:52'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MF3 из vercel run#2 (m-28). checks run --phase coverage в ходе POST-permutations создал реальный edge-config на аккаунте и НЕ почистил за собой (пришлось удалять вручную, raw/63-cleanup-orphan-edgeconfig.log). Probes self-clean (orphans registry), а coverage-фаза checks run — нет. Fix: checks run должен регистрировать созданные в coverage-фазе ресурсы в orphans registry + cleanup, паритет с probe. Связано: ARV-102 (probe cleanup orphans).
<!-- SECTION:DESCRIPTION:END -->
