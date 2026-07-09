---
id: ARV-375
title: add multi-spec merge/union support (zond add api --merge / merge-api command)
status: Done
assignee: []
created_date: '2026-07-09 08:52'
updated_date: '2026-07-09 09:54'
labels:
  - feature
  - generator
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session: merged docgen-core-service v20 (196 endpoints) + v30 (57 endpoints) into one 253-endpoint audit target. zond has zero native support for this — had to hand-write a python script that:
- unions `paths` dicts from two dereferenced spec.json files (no key collisions in this case, but need a documented collision policy — last-wins? error?)
- unions `components.schemas` / `components.securitySchemes`
- rewrites `info.title`/`info.version`
- writes the merged JSON to a scratch file, then `zond add api --spec <merged.json>`

This is a recurring need, not a one-off: any org running multiple API versions side-by-side (v1/v2, deprecated-but-still-live + current) will want combined coverage instead of re-scanning each version separately and manually reconciling reports.

Proposed shape (not prescriptive — pick what fits zond's existing UX):
- `zond add api <name> --spec <urlOrPath1> --spec <urlOrPath2> [...]` — accept --spec multiple times, merge before writing spec.json
- or `zond merge-api <name1> <name2> --out <mergedName>` operating on two already-registered APIs

Must handle: path-key collisions (two specs declaring the same path — need an explicit policy, at minimum a warning), schema name collisions (component schemas with the same name but different shape — silent last-wins is a correctness trap), and should surface a merge summary (N paths from spec A, M paths from spec B, K collisions) so the agent doesn't have to reverse-engineer it like this session did.

Litmus test: pure deterministic JSON merge, no severity/FP/blame judgment — belongs in zond core.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
--spec repeatable → deterministic union in src/core/spec/merge-specs.ts (last-wins on path/component collision, surfaced as warnings). Wired via setupApi specs[]. Verified: docgen v20+v30 → 34 paths, version v20+v30. Tests: tests/spec/merge-specs.test.ts.
<!-- SECTION:NOTES:END -->
