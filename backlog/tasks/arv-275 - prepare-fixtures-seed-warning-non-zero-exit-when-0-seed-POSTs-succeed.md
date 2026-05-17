---
id: ARV-275
title: 'prepare-fixtures --seed: warning + non-zero exit when 0% seed POSTs succeed'
status: To Do
assignee: []
created_date: '2026-05-17 13:29'
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
- [ ] #1 Summary block в конце: Discovery vs Seed counts
- [ ] #2 Warning line if seed success rate < 50%
- [ ] #3 Exit code 2 если seed attempted и 0% успеха
<!-- AC:END -->
