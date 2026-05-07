---
id: TASK-178
title: 'repo-hygiene: keep zond binary out of repo root, db in .zond/'
status: To Do
assignee: []
created_date: '2026-05-07 06:48'
labels:
  - cleanup
  - workspace
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас build кладёт ./zond в корень репо, а sqlite-БД (zond.db, zond.db-shm, zond.db-wal) тоже создаётся рядом с исходниками. Файлы в gitignore, но физически шумят и легко уезжают через xattr/copy. Цель: бинарь — только dist/zond, БД — workspace-aware путь .zond/zond.db.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 package.json build → outfile dist/zond
- [ ] #2 scripts/codesign-darwin.ts работает с dist/zond
- [ ] #3 default DB path → <workspace>/.zond/zond.db (как .zond/manifest.json)
- [ ] #4 feedback memory 'install global zond after build' обновлён под dist/
- [ ] #5 install.sh + install.ps1 не ломаются (они качают release-tarball, не корневой)
<!-- AC:END -->
