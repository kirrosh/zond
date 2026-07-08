---
id: ARV-339
title: 'm-24: field-level body/schema diff for zond db compare'
status: Done
assignee: []
created_date: '2026-07-06 08:45'
updated_date: '2026-07-06 08:52'
labels:
  - m-24
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from ARV-338 (scope cut, 2026-07-06): db compare today diffs only status transitions (pass→fail). Add field-level body/schema diff between two runs of the same test — what changed in the response shape after an API change. Status-diff already answers 'what broke'; this answers 'how the contract moved'. Reuse stored response_body/assertions rows; no new capture needed.
<!-- SECTION:DESCRIPTION:END -->
