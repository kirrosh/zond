---
id: ARV-109
title: 'doctor: integrate stale-fixture detection (currently only --verify path)'
status: To Do
assignee: []
created_date: '2026-05-11 08:51'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F16, class missing-feature
API: sentry

Repro:
  # After round 2 (live probes + audit)
  zond doctor --api sentry --missing-only --json
  # multi-API bug F1 fixed (ARV-96), but doctor still doesn't surface stale fixtures.
  # workaround:
  zond prepare-fixtures --api sentry --verify
  # → Verify summary: 1 live, 2 stale, 0 unknown.
  # team_id_or_slug=a2he2ruy → 404 (probe-mass-assignment deleted in cleanup)
  # version=1775261897 → 404

Expected: zond doctor itself does stale-check (HEAD/GET on path using var) and marks stale-vars in --missing-only output. Skill (zond/SKILL.md L83) promises 'zond doctor --api <name> --missing-only before generating fixtures or touching .env.yaml' — but only covers UNSET-vars, not STALE-vars.

Actual: doctor silent on stale; prepare-fixtures --verify writes stale-summary, but it's not part of pre-flight workflow in skill. Between prepare-fixtures and run, any probe-cleanup can mark a fixture stale, and the next run works on a 404-stale-id.

Effect: smoke-pass shows fictional 'assertion fails / 404' instead of clear 'stale fixture, run --refresh'. Skill (L711) mentions --verify/--refresh only in Phase 5.4 (post-probe hygiene), not in round-to-round fixture-update flow.

Log: rounds/raw-03.log block '=== prepare-fixtures --verify ==='
<!-- SECTION:DESCRIPTION:END -->
