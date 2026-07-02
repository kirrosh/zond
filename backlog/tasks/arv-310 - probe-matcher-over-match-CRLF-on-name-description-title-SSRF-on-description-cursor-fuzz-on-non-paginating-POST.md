---
id: ARV-310
title: >-
  probe matcher over-match: CRLF on name/description/title, SSRF on description,
  cursor-fuzz on non-paginating POST
status: To Do
assignee: []
created_date: '2026-07-02 11:09'
labels:
  - zond-side
  - anti-fp
dependencies: []
references:
  - ARV-259
  - ARV-273
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Security/probe matchers select fields that are not real sinks, inflating plans and (if executed) producing non-actionable findings. Observed on GitHub scan: CRLF matched name x37, name,description x22, title x9; SSRF matched a group incl. description; cursor_boundary_fuzzing fired on POST /user/repos (a create endpoint that does not paginate). CRLF should target header-reflected/redirect fields; SSRF only URL-shaped (url, *_url, *_uri); cursor-fuzz only paginating GETs. Route into anti-fp registry. Related: ARV-259 (anti-fp registry), ARV-123..126, ARV-273 (cursor_boundary_fuzzing class). Found via zond-audit github runs (report-zond Z3 / report-api L1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CRLF matcher excludes free-text name/description/title; SSRF matcher restricted to URL-shaped field names
- [ ] #2 cursor_boundary_fuzzing only fires on paginating GET operations, not create/mutation endpoints
<!-- AC:END -->
