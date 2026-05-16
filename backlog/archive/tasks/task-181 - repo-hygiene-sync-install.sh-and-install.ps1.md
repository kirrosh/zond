---
id: TASK-181
title: 'repo-hygiene: sync install.sh and install.ps1'
status: Done
assignee: []
created_date: '2026-05-07 06:48'
updated_date: '2026-05-07 07:06'
labels:
  - cleanup
  - install
milestone: m-11
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
install.ps1 (apr 26) и install.sh (apr 30) разошлись. ps1 не имеет логики codesign/xattr и detection-веток, добавленных в .sh. Привести к одному поведению (поддержка x64/arm64, detection latest tag, дружелюбный fallback на ~/.local/bin). Документации про Windows-путь нет — добавить.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 install.ps1 повторяет логику install.sh: detect platform, download tag, чек хешей не требуется
- [ ] #2 Оба скрипта тестируются на чистом окружении (мини-чек: detection + download + run --version)
- [x] #3 README ссылается на оба
<!-- AC:END -->
