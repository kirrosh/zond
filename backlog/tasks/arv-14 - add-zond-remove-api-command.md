---
id: ARV-14
title: add zond remove api command
status: Done
assignee: []
created_date: '2026-05-10 07:13'
updated_date: '2026-05-10 07:19'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F2, class missing-feature
Repro: zond rm api resend → 'unknown command'. zond add api resend --spec ... → 'API already exists'.
Expected: команда удалить зарегистрированный API (zond remove api <name> или zond api delete <name>). Без неё, чтобы поменять spec-URL, надо либо --force (re-register), либо вручную удалять директорию + чистить SQLite.
Actual: команды remove/rm/delete нет вообще.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond remove api <name> удаляет collection из DB и опционально все связанные runs/results
- [x] #2 По умолчанию команда удаляет только DB-запись и dir apis/<name>; runs обнуляются (collection_id=NULL)
- [x] #3 Флаг --purge также удаляет runs+results связанные с API
- [x] #4 Флаг --keep-files оставляет директорию apis/<name> на диске (только удаление из DB)
- [x] #5 Если API был активен (.zond/current-api) — current-api маркер очищается
- [x] #6 Без --yes команда требует подтверждения когда не --json (interactive); с --yes идёт молча
- [x] #7 JSON envelope ok/error с deletedCollectionId, deletedRuns, removedDir
<!-- AC:END -->
