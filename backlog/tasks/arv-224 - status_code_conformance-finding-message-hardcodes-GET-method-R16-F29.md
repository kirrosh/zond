---
id: ARV-224
title: status_code_conformance finding message hardcodes GET method (R16/F29)
status: To Do
assignee: []
created_date: '2026-05-14 10:11'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 16, finding F29, class likely_bug / ux-papercut, severity LOW.

Repro:
  zond checks run --api github --phase coverage --check status_code_conformance --include 'path:^/emojis$' --report ndjson > /tmp/c.ndjson
  jq -s '[.[]|select(.type=="finding")|.finding|{sig:.request_signature,msg:.message}][0:3]' /tmp/c.ndjson
  # → request_signature has POST/PUT/PATCH, but .message says 'for GET /emojis'

Expected: finding.message should rephrase method to match the actual request signature.
Actual: hardcoded 'GET' (or method of the declared operation, not the probe request).

Impact: SARIF + agent triage + db diagnose surface the wrong method, false-direction debugging.

Log: see feedback-16.md F29.
<!-- SECTION:DESCRIPTION:END -->
