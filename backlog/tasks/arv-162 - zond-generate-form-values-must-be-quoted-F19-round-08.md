---
id: ARV-162
title: 'zond generate: form values must be quoted (F19 / round-08)'
status: Done
assignee: []
created_date: '2026-05-12 12:19'
updated_date: '2026-05-12 12:25'
labels:
  - feedback-loop
  - api-stripe
  - m-16
  - form-encoding
  - generator
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 08, finding F19, class definitely_bug.

Severity: high — 21 of 68 suites silently skipped without warning.

Repro: zond add api stripe --force && zond generate apis/stripe/spec.json && zond run apis/stripe/tests

Expected: form values are ALWAYS strings on the wire (application/x-www-form-urlencoded has no native numbers/bools/nulls). Generator must emit quoted scalars in form: blocks:
  form:
    phone: "+1234567890"
    width: "12.5"
    application_fee_percent: "25"

Actual: emits unquoted phone/decimal/signed-integer values:
  form:
    phone: +1234567890
    "shipping[phone]": +1234567890
    "package_dimensions[height]": 12.5
YAML parser reads them as int/float; zond check tests rejects with 'expected string, received number'; zond run silently skips the invalid suites with no Warning: Skipped <file> line (would have surfaced the masking).

Workaround: node script /tmp/patch-form-numbers-v2.js (regex [+-]?\d[\d.eE+\-]* in form: block → quote).

Root cause: src/core/generator/serializer.ts yamlScalar quotes /^\\d+$/ but not decimals (12.5), not signed integers (+1234), not phone-like strings. For form: blocks specifically, every value should be force-quoted since the wire form is string-only.

Two parts to fix:
1. serializer.ts form: emission — always wrap value in double quotes (or extend yamlScalar to cover decimals/signed numbers/leading + or -).
2. zond run — when suite skipped due to validation failure, surface a Warning line so 21/68 silent skips become loud.

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-08.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: serializer always force-quotes form: values (no more silently parsed-as-int phone/decimal values). zond run prints loud trailing summary when parse-time validation skipped files. Tests: 4 new round-trip cases in tests/generator/serializer.test.ts (ARV-162).
<!-- SECTION:NOTES:END -->
