---
id: ARV-107
title: 'report bundle case-study: <TODO: API name> placeholder remains with --api set'
status: Done
assignee: []
created_date: '2026-05-11 08:51'
updated_date: '2026-05-11 09:03'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F13, class ux-papercut
API: sentry

Repro:
  zond report bundle 19 --include case-study -o .fb-loop/rounds/bundle-19/
  grep -B1 -A3 '<TODO' .fb-loop/rounds/bundle-19/19/case-study.md
  # → '- **API:** <TODO: API name>'
  # → '<TODO: paste the relevant slice of the OpenAPI spec>'

Expected: 'API' auto-fills from apis/<name>/spec.json:info.title (or --api <name> argument). 'Spec slice' — auto-extract relevant operation block from spec.json. Skill (zond/SKILL.md L800: 'Case-study fills TL;DR / Context / Spec / Repro / What happened / Why it matters; missing fields become <TODO: ...> placeholders').

Actual: even with --api sentry and apis/sentry/spec.json present, info.title extractable, '<TODO: API name>' and '<TODO: paste the relevant slice of the OpenAPI spec>' remain as-is.

Effect: every bundle requires manual final editing. Skill encourages 'report bundle' right after run — but case isn't share-ready without editing.

Log: .fb-loop/rounds/bundle-19/19/case-study.md L11-15
Related: skill-drift SD8
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Round 03: case-study autopopulates API name from --api slug and spec slice via specDoc lookup. See tests/core/exporter/case-study-repro.test.ts.
<!-- SECTION:NOTES:END -->
