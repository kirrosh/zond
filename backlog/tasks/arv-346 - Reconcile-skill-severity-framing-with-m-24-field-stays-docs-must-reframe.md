---
id: ARV-346
title: 'Reconcile skill severity framing with m-24 (field stays, docs must reframe)'
status: To Do
assignee: []
created_date: '2026-07-06 11:18'
labels:
  - skill-drift
  - docs
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audits 2026-07-06. Findings still carry severity: high|medium|low, and skills (zond/SKILL.md ~L379/386 severity matrix; zond-checks/SKILL.md:255 "triage by recommended_action first, then by severity") still teach a severity-first model. Decision (2026-07-06): the severity FIELD stays — it is a deterministic per-check default and is load-bearing for the CI exit code (high_or_critical) and SARIF mapping, NOT the removed ARV-337 calibrator. What must change is the DOCS: reframe severity as a coarse deterministic CI-gate default; the agent prioritizes from recommended_action + raw evidence, not from zonds severity. Update init skill templates (src/cli/commands/init/templates/skills/*.md) accordingly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 skill templates describe severity as a deterministic CI-gate default, not the agents priority verdict
- [ ] #2 no code change to the severity field
<!-- AC:END -->
