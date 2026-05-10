---
id: ARV-23
title: 'generate --explain: ''from'' email field gets randomDomain heuristic'
status: To Do
assignee: []
created_date: '2026-05-10 07:25'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F4, class likely_bug
Repro: zond generate --api resend --explain → POST /emails: from string {{$randomDomain}} [heuristic:domain-from-description]. Spec says from is email format ('Name <user@domain>' or 'user@domain').
Expected: heuristic should pick {{$randomEmail}} when the field is format=email, regardless of the name containing 'from'. format=email > name-substring rule.
Actual: name-substring 'from' triggers domain-from-description, body becomes acme.com style → guaranteed 400 on unsafe POST.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->
