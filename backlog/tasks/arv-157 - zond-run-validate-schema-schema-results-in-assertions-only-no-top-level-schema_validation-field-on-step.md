---
id: ARV-157
title: >-
  zond run --validate-schema: schema results in assertions[] only, no top-level
  schema_validation field on step
status: Done
assignee: []
created_date: '2026-05-12 11:10'
updated_date: '2026-05-12 11:11'
labels:
  - feedback-loop
  - api-stripe
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F11, class likely_bug/missing-feature

Repro: zond run apis/stripe/tests --safe --validate-schema --report json --report-out run.json
Expected: per step result schema_validation: {result: PASS|FAIL, matched_endpoint, error_count} block — skill .claude/skills/zond/SKILL.md:336 describes this. Tester filters jq '[.[].steps[] | .schema_validation]' expecting populated entries.
Actual: 0 entries. Schema-validator output gets folded into assertions[] with kind:'schema' but no top-level summary. Indistinguishable from 'no drift' vs 'never validated'.

Effect: depth-pass for schema drift unobservable without knowing the internal assertion-kind taxonomy.

Log: $HANDOFF/rounds/run-validate-schema-04.json
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added optional schema_validation block to StepResult. Populated in both executor branches. Shape mirrors zond request --validate-schema. Commit 214d23d.
<!-- SECTION:NOTES:END -->
