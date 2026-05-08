---
id: TASK-228
title: 'doctor: catalog: missing при совпадающем sha256 в manifest'
status: Done
assignee: []
created_date: '2026-05-08 07:56'
updated_date: '2026-05-08 08:03'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback rounds 01 F1, 02 F2 (re-confirm), 03 F6 (sha256-proof), class definitely_bug
Repro: ls -la apis/sentry/.api-catalog.yaml && shasum -a 256 apis/sentry/.api-catalog.yaml && jq '.generated[]|select(.category=="catalog")' .zond/manifest.json && zond doctor --api sentry
Expected: ✓ catalog: fresh (хеши совпадают)
Actual: ✗ catalog: missing — несмотря на совпадающий sha256 8ff34371... в manifest и на диске; resources и fixtures работают корректно, категория catalog обрабатывается отдельно
Log: /tmp/zond-fb/sentry/rounds/raw-02.log (doctor recheck секция + shasum)
<!-- SECTION:DESCRIPTION:END -->
