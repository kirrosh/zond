---
id: ARV-126
title: 'anti-fp: migrate security-probe baseline-echo / boundary checks into registry'
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 15:21'
labels:
  - m-19
  - refactor
  - anti-fp
dependencies:
  - ARV-123
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§2.4 refactor-plan. src/core/probe/security-probe.ts содержит inline guard'ы baseline-echo (раньше тот же URL вернулся в response без mutation) и boundary-related skip. Вынести в registry.

Правила:
- baseline-echo (security-probe specific)
- coverage-phase-boundary (ARV-77) — применимо и к checks
- (опционально) discriminator-oneOf (ARV-78) — применимо к data-factory

security-probe.ts вызывает applyAntiFp() вместо inline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/anti-fp/rules/{baseline-echo,coverage-phase-boundary}.ts существуют
- [x] #2 inline guard'ы в security-probe.ts удалены
- [x] #3 ARV-77 fixture-test проходит
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/anti-fp/rules/baseline-echo.ts:
- BASELINE_ECHO_RULE: FpRule on scope probe:security, takes {responseBody, baselineBody}, fires on deep-equal (server ignored attack). Inline deepEqual covers array/object structural equality, fail-open when baselineBody is undefined.

src/core/anti-fp/rules/coverage-phase-boundary.ts: top-level canonical re-export of the existing schemathesis coverage_phase_boundary_positive rule (kept in attributed subfolder as source-of-truth; AC#1 requires the file name slot under rules/).

src/core/anti-fp/bootstrap.ts: BASELINE_ECHO_RULE registered alongside SCHEMATHESIS_RULES + SENTRY_RULES.

src/core/probe/security-probe.ts:
- imports applyAntiFp + BaselineEchoCtx type
- in the attack loop, the 2xx-no-echo "low" classification (mode=full) is routed through applyAntiFp(probe:security). On baseline-echo hit, severity downgrades to "ok" and the reason embeds the rule's wontfix banner + ruleId for traceability.
- Partial-body mode unchanged — no baseline response body is retained for that path.

Tests:
- tests/core/anti-fp/baseline-echo.test.ts (7 cases): rule metadata, deep-equal positive/negative, undefined-baseline fail-open, nested arrays, applyAntiFp bootstrap reachability.
- 1898 tests pass full-suite; typecheck clean.
- AC#3 ARV-77 fixture-test (coverage_phase_boundary_positive in schemathesis bundle) remains green — re-export doesn't touch the existing registration.

Note: security-probe didn't have explicit baseline-echo inline guards before this task — the migration ships the rule + the wiring slot so future findings (or m-18 layered probes) have a single registry hook instead of reinventing one.
<!-- SECTION:NOTES:END -->
