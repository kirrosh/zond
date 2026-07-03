---
id: ARV-323
title: >-
  ARV-323: checks run --phase coverage misreports 0 events flushed after SIGTERM
  timeout despite partial NDJSON on disk
status: To Do
assignee: []
created_date: '2026-07-03 07:41'
labels:
  - checks
  - ndjson
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260702-210359 (raw/30-checks.ndjson, raw/30-checks.stderr.log). 'zond checks run --api stripe --phase coverage --workers 4 --rate-limit 30 --report ndjson' was killed by the caller's 10-minute timeout (SIGTERM/signal 15) partway through Stripe's ~325+ write + read endpoints at rate-limit 30. zond itself logged to stderr: 'NDJSON run interrupted (signal 15); 0 event(s) flushed' -- but the output file already had 22275 NDJSON lines (~16.7MB) written before the kill. So the self-reported flush count (0) contradicts the actual file contents (partial-but-real data). Likely an unflushed in-memory counter/summary being reset or never incremented on the SIGTERM path, distinct from the underlying stream writer (which clearly did flush to disk incrementally). Risk: a caller trusting the '0 flushed' message would discard/ignore a partial result that is actually usable. Fix: either flush-count the real written-record count on SIGTERM, or stop claiming a flushed-count at all when the process is being killed mid-stream.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 on SIGTERM during an ndjson run, the reported flushed-event count matches (or is documented as a lower bound of) the actual lines written to the output file
<!-- AC:END -->
