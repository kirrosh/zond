---
id: ARV-275
title: 'prepare-fixtures --seed: warning + non-zero exit when 0% seed POSTs succeed'
status: Done
assignee: []
created_date: '2026-05-17 13:29'
updated_date: '2026-05-18 11:51'
labels:
  - ux
  - prepare-fixtures
  - seed
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`prepare-fixtures --apply --cascade --seed` тихо идёт дальше после массовых seed-POST 400. Итог: `Filled 27/92 path-FK vars (29%)` выводится позитивно, юзер не знает что **26/26 seed-POSTs провалились**.

## Evidence (Stripe live, 2026-05-17)

```
zond prepare-fixtures --api stripe --apply --cascade --seed
→ 26 POST attempts × 400 (zond-generated bodies невалидны для Stripe)
→ exit 0
→ "Filled 27/92 path-FK vars (29%)"  ← все 27 от discovery, 0 от seed
```

## Fix

В конце `prepare-fixtures` summary добавить:

```
Discovery: filled X/Y from list-endpoints (cascade Z passes)
Seed POST attempts: N total, M succeeded (M/N=K%)
  ⚠ If seed success rate < 50% → likely missing seed_body overlay (see ARV-187/ARV-269/ARV-270)
```

И exit code:
- 0 если discovery > 0 OR seed > 0
- 2 (warning) если seed attempted but 0% succeeded — сигнал юзеру что что-то не так

## Refs

- Phase-1 report UX4
- ARV-187 (overlay), ARV-269 (overlay wiring), ARV-270 (auto-seed-bodies)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Summary block в конце: Discovery vs Seed counts
- [x] #2 Warning line if seed success rate < 50%
- [x] #3 Exit code 2 если seed attempted и 0% успеха
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/cli/commands/bootstrap.ts: текстовый summary теперь разделяет Discovery vs Seed counts, warning при <50% seed success, exit 2 при 0% seed success (когда seeds attempted). JSON envelope.summary уже содержал seedsAttempted/seedsSucceeded. Тесты: tests/cli/bootstrap-seed-failure.test.ts (2 кейса).
<!-- SECTION:NOTES:END -->
