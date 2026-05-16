---
id: TASK-215
title: 'zond add api: артефакты STALE сразу после add (specHash mismatch)'
status: Done
assignee: []
created_date: '2026-05-07 14:21'
updated_date: '2026-05-07 14:26'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F7, class definitely_bug
Repro:
  1. zond add api resend --spec https://resend.com/openapi.json -> 'Artifacts: spec.json + .api-catalog.yaml ...'
  2. zond doctor --api resend
  -> catalog/resources/fixtures: STALE (artifact specHash 792c2bb9... != spec.json 4266189c...)
  -> exit 2
Expected: после add api все артефакты fresh (specHash совпадает)
Actual: артефакты сразу STALE — хеш считается по-разному при add (по dereferenced doc) vs doctor (по байтам spec.json)
Workaround: zond refresh-api сразу после add
Fix-hint: унифицировать canonicalization specHash в writeArtifactsFromDoc и doctor's freshness check
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->
