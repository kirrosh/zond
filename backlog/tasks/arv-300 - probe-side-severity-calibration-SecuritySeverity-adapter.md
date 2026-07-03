---
id: ARV-300
title: 'probe-side severity calibration: SecuritySeverity adapter'
status: To Do
assignee: []
created_date: '2026-05-18 14:23'
updated_date: '2026-07-02 14:07'
labels:
  - severity
  - calibration
  - validation-sprint
  - m-23
dependencies:
  - ARV-283
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-283 Phase A wired calibrate() в core/checks/runner.ts для checks-side. НЕ wired в probe-side: core/probe/{security,mass-assignment,static,webhooks}/* эмитят findings со своим SecuritySeverity enum (low|medium|high|info|inconclusive|skipped|ok), не совместимым с core/severity Severity (critical|high|medium|low|info). Stripe-noise reduction для probe-classes через bundled-profile (ARV-283 AC#5) невозможен без этого моста. Решение: либо адаптер SecuritySeverity ↔ Severity (info/inconclusive/skipped/ok passthrough; low/medium/high маппятся в Severity и обратно), либо generalize calibrator на any enum. Wire в emission-path всех probe-классов + cli/commands/probe/* загружают loadSeverityConfig.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Probe findings проходят через calibrator до записи в JSON envelope / ndjson
- [ ] #2 Sentinel severity (info/inconclusive/skipped/ok) переживают round-trip без mutation
- [ ] #3 severity.yaml suppression с when.finding.check: ssrf подавляет соответствующие probe findings (integration test)
- [ ] #4 bun test + bun run check проходят
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Security-probe slice done (commit pending): core/severity/probe-adapter.ts (calibrateProbeSeverity — sentinel passthrough, string-keyed so enum-agnostic), rollupSecuritySeverity exported from security/orchestrator.ts, calibrateSecurityVerdicts wired in cli/commands/probe/security.ts after result. AC#2 (sentinel round-trip) + AC#3 (when.finding.check: ssrf suppression) covered by tests/core/probe/probe-severity-calibration.test.ts (5/5). AC#1 met for security only — mass-assignment/static/webhooks carried to ARV-311. bun run check + full suite green (2484/0).
<!-- SECTION:NOTES:END -->
