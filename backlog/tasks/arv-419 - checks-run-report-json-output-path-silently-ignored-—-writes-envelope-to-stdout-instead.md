---
id: ARV-419
title: >-
  checks run --report json --output <path> silently ignored — writes envelope to
  stdout instead
status: Done
assignee: []
created_date: '2026-07-10 12:39'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28). 'zond checks run --api stripe --include ... --phase examples --report json --output raw/30-checks-examples.json' exited 0 but never created raw/30-checks-examples.json — the full JSON envelope went to stdout instead, silently. Repro'd twice (examples phase and a narrower retest). No warning/error either way. Per the command's own --help text, --output is documented as honored 'with --report sarif' (defaults filename) and 'with --report ndjson' (redirects the stream) — json/console/markdown are never mentioned, so --output is a silent no-op for --report json specifically. This is inconsistent with 'zond run --report json --output <path>' (used earlier in the same session), which DOES write the file as expected. Two deterministic fixes, either is fine: (a) make 'checks run --report json --output <path>' write the envelope to the file (matching 'zond run's behaviour and the principle of least surprise), or (b) if json+output is intentionally unsupported, exit non-zero / print a warning to stderr instead of silently accepting the flag combination. Evidence: zond-runs/stripe-run3-20260710/raw/30-checks-examples.stdout.log (the JSON landed on stdout, captured only because stdout was separately redirected in this run) vs raw/20-run-smoke.json (zond run wrote the file correctly with the same-shaped flags).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: checks run --report json --output <path> now writes the envelope to the file (mirrors zond run + the markdown branch). Verified live: file created, stdout empty, 'JSON report written to' on stderr.
<!-- SECTION:NOTES:END -->
