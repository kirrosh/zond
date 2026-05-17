---
id: ARV-274
title: 'zond doctor --json: exit 0 on JSON-emit success regardless of fixture state'
status: To Do
assignee: []
created_date: '2026-05-17 13:29'
labels:
  - ux
  - doctor
  - cli
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond doctor --json` возвращает exit 1 когда фикстуры UNSET, даже если JSON envelope корректен (`ok: true`).

```
$ zond doctor --api stripe --json > out.json; echo $?
1
$ jq '.ok' out.json
true
```

В /zond-scan скилле приходится писать `... 2>&1; echo "exit=$?"` на каждом вызове, иначе `set -e` rolls.

## Fix

`doctor --json` → exit 0 если JSON-emit прошёл успешно. Reserve non-zero под command failure (missing api, bad spec). Fixture state — это **data**, не failure.

## Refs

- Phase-1 report UX1
- Memory feedback_zond_no_llm_calls (consistent CLI behavior)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 doctor --json exit 0 если JSON output valid, независимо от UNSET fixtures
- [ ] #2 doctor --json exit non-zero только на command failure (missing api, parse error)
<!-- AC:END -->
