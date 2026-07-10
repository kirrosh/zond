---
id: ARV-422
title: >-
  add api overwrites насеянный .env.yaml при ре-регистрации существующего API —
  потеря fixtures
status: Done
assignee: []
created_date: '2026-07-10 12:44'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
  - zond-core
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
При `zond add api <name> --spec ...` для API, у которого уже есть каталог apis/<name>/ с насеянным .env.yaml, команда безусловно перезаписывает .env.yaml дефолтными пустыми values — насеянные fixture-id теряются без предупреждения. Воспроизведено в stripe-run3: пришлось вручную восстанавливать 25 значений. Litmus: детерминировано → zond-core. Fix: при существующем .env.yaml либо merge (сохранять непустые values), либо warn + backup, либо require --force для перезаписи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 add api не затирает непустые values в существующем .env.yaml (merge/backup/--force)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: setup-api.ts merges existing .env.yaml on re-registration (existing non-empty values + @secret refs win; new spec vars get placeholders) and backs up to .env.yaml.bak. parseEnvValues reads RAW values (no @secret resolution → no secret leak into .env.yaml). Unit tests added.
<!-- SECTION:NOTES:END -->
