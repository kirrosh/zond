---
id: ARV-62
title: >-
  probe security --emit-tests: escape CRLF in YAML name/json fields (raw \r\n
  breaks zond run)
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-11 07:34'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3, class definitely_bug. Repro: zond probe security --api resend ssrf,crlf,open-redirect --emit-tests apis/resend/probes/security; then zond run apis/resend/probes/security. Expected: generated regression suites are valid YAML that zond run can pick up. Actual: apis/resend/probes/security/probe-security-patch-templates-by-id.yaml:14 contains raw CRLF inside double-quoted YAML scalar; YAML parser crashes with 'bad indentation of a mapping entry'; 0 cases run from these files. Same bug in 'json:' field. Fix: use escaped \r\n in double-quoted strings, or block scalar (|-). Impact: probe security branch of CI regression broken end-to-end. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 yamlScalar() escapes \\, ", LF, CR, TAB, and any \x00-\x1f or \x7f byte instead of emitting the raw byte inside double-quoted scalars
- [x] #2 regression test: serializeSuite on a step whose name+json contain raw \r\n yields YAML that Bun.YAML.parse round-trips back to the original bytes
- [x] #3 regression test: tab and \x00/\x7f are emitted as escaped sequences and survive round-trip
- [x] #4 existing serializer test suite still passes (no regression for non-control payloads)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-03/F19 confirmed open against round-01 binary; fix landed before tester re-tested. Round-04 verify (V-F3) shows 3/3 yaml files parse cleanly.
<!-- SECTION:NOTES:END -->
