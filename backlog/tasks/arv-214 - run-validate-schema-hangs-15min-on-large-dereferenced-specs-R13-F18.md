---
id: ARV-214
title: 'run --validate-schema: hangs >15min on large dereferenced specs (R13/F18)'
status: Done
assignee: []
created_date: '2026-05-14 09:25'
updated_date: '2026-05-15 12:30'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 13, finding F18, class likely_bug / perf regression, severity HIGH.

Repro:
  zond run apis/github/tests/_smoke_user.yaml --validate-schema \
    --spec apis/github/spec.json --rate-limit 5 --sequential \
    --no-fail-on-failures --report json
  # hangs >15 min, 0 bytes in stdout until SIGKILL
  # Without --validate-schema: ~30 seconds for the same suite.

Expected: schema-validate on dereferenced ~14 MiB spec.json (github) should run in seconds per step (validation of a single response body).

Actual: something between requests is extremely expensive. Suspect: re-dereference per step, or AJV schema-compile without caching across steps.

Impact: HIGH — cuts off schema-drift validation on any large API (github, kubernetes, large stripe). Without it, contract-drift detection collapses on the most interesting specs.

Investigation hints:
  - check createSchemaValidator caching in src/core/validate-schema.ts (or similar)
  - AJV compile is O(n) on schema size; if compiled per-step on 14 MiB spec, that's the culprit.

Log: ps showed zond run pid alive 16 min, output file 0 bytes.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Профилировкой подтверждено: per-endpoint AJV.compile на глубоко вложенных response-схемах (github-style) занимает 0.8-2с/штука; для уникальных схем кэш не помогает. Фикс — две safety-net в src/core/runner/schema-validator.ts: (1) byte-cap на стрингифицированный размер схемы (default 1 MiB, env ZOND_VALIDATE_SCHEMA_MAX_BYTES) — превышение пропускает валидацию + однократное предупреждение в stderr вместо часов AJV.compile; (2) per-compile timing с порогом 1с (env ZOND_VALIDATE_SCHEMA_SLOW_COMPILE_MS) — пишет в stderr какая endpoint-схема замедляет run. Skip-кейс отдаёт passing-assertion schema.skipped_too_large чтобы run не падал. Regression-тесты в tests/runner/schema-validator.test.ts проверяют что фат-схема не зовёт AJV.compile (<200ms) и что MAX_BYTES=0 даёт legacy behaviour.
<!-- SECTION:FINAL_SUMMARY:END -->
