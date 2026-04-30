---
id: TASK-97
title: >-
  register {{$nullByte}} generator (referenced in YAML parser hint but not in
  runtime)
status: To Do
assignee: []
created_date: '2026-04-30 07:47'
labels:
  - generator
  - consistency
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the YAML parser encounters a literal NUL byte in source it suggests:
> use the {{\$nullByte}} generator instead of inlining the byte

This hint was added together with TASK-71 (file:line:col on parse errors). However the generator itself is not registered:

```
$ zond run /tmp/nul.yaml  # contains "{{\$nullByte}}"
Error: Unknown generator: {{\$nullByte}}. Available: \$uuid, \$timestamp, \$isoTimestamp, \$randomName, \$randomEmail, \$randomInt, \$randomString, \$randomUrl, \$randomFqdn, \$randomIpv4, \$randomDate, \$randomIsoDate
```

Classic dangling-promise: the parser hint sends users to a feature that does not exist. Two options:

## Option 1 — implement the generator (recommended)
Returns the byte `\u0000`. Trivial body: `() => "\u0000"`. Useful for security-fuzzing that the test framework currently can't express (NUL-injection in email local-parts, header values, URL paths). Round-2 review specifically called this out as a gap.

## Option 2 — remove the hint
Drop the "use the {{\$nullByte}} generator" sentence from the parse error message. Cheaper but loses fuzzing capability.

Option 1 is preferred because it closes a real fuzzing gap, not just a docs gap.

## Acceptance
- `{{\$nullByte}}` resolves to a single NUL byte in any string-context substitution.
- Generator listed in the "Available:" enumeration of the unknown-generator error.
- Unit test: a YAML that uses `{{\$nullByte}}` in a query param and a JSON body field renders to bytes containing 0x00 in the corresponding place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 {{$nullByte}} resolves to byte 0x00 in path / query / header / body string contexts
- [ ] #2 Listed in 'Available' generators in the unknown-generator error
- [ ] #3 Unit test verifies actual NUL byte ends up in the rendered request
<!-- AC:END -->
