---
id: ARV-312
title: >-
  open_cors_on_sensitive emits HIGH findings with response_summary.status:0
  (unverified evidence)
status: To Do
assignee: []
created_date: '2026-07-02 14:19'
labels:
  - severity
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on live Stripe zond-audit run 20260702-170615 (auth-gated). 261/261 open_cors_on_sensitive findings carry severity:high AND response_summary.status:0 — no HTTP response was captured, yet the finding asserts variant:reflected+credentials with concrete Access-Control-Allow-* header values and emits fix_auth_config. Violates the m-21 core principle 'no evidence → no high severity': a HIGH from status:0 has no verified response behind it. 261 identical phantom HIGHs drown real signal. Fix: the check must suppress or downgrade (to info/skip) when status==0 (no response captured). Verify: jq 'select(.finding.check=="open_cors_on_sensitive").finding.response_summary.status' raw/30-checks.ndjson → all 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 open_cors_on_sensitive does not emit high/medium when response_summary.status==0
- [ ] #2 status==0 path yields skip or info with a 'no response captured' reason
- [ ] #3 regression test: a probe that never got a response produces no HIGH cors finding
<!-- AC:END -->
