---
id: ARV-274
title: 'zond doctor --json: exit 0 on JSON-emit success regardless of fixture state'
status: Done
assignee: []
created_date: '2026-05-17 13:29'
updated_date: '2026-05-18 11:47'
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
- [x] #1 doctor --json exit 0 если JSON output valid, независимо от UNSET fixtures
- [x] #2 doctor --json exit non-zero только на command failure (missing api, parse error)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
doctor --json теперь возвращает exit 0 после successful envelope emit, независимо от fixture/staleness state (src/cli/commands/doctor.ts). Text mode сохраняет старое поведение (exit 1/2). Тесты: 3 новых в doctor.test.ts (ARV-274).
<!-- SECTION:NOTES:END -->
