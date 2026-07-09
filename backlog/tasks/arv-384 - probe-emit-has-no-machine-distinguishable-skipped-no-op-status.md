---
id: ARV-384
title: probe emit has no machine-distinguishable skipped/no-op status
status: Done
assignee: []
created_date: '2026-07-09 11:41'
updated_date: '2026-07-09 11:47'
labels:
  - zond-audit
  - ux
  - probe
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From petstore v0.26.0 verify audit (report-zond MF1 root).

When a probe legitimately matches 0 fields (e.g. security ssrf/crlf/open-redirect on petstore) it prints `SKIPPED N` + "Directory not created" to stderr, but emits no scriptable status. An orchestrator cannot tell "nothing to probe" from "probe broke". Add an explicit `{status:"skipped",reason:...}` JSON (or distinct exit code) to the probe emit. NOTE: the downstream run-side false-green is fixed separately in ARV-383; this task is the probe-side signal only.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed as already-resolved (litmus verdict). zond ALREADY emits the machine-distinguishable skipped signal the philosophy asks for: `probe security --json` returns a `by_status.skipped` count + per-endpoint closed-enum `skip_reason` (no-body|no-matched-field|isolated-protected|unresolved-path). The real "indistinguishable from broken" symptom was the downstream `zond run <uncreated-dir>` step, fixed in ARV-383. Nothing to add to core; the audit workflow just captured .log instead of consuming --json.
<!-- SECTION:NOTES:END -->
