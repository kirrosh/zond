---
id: ARV-391
title: >-
  README/landing distribution-pass: install matrix + demo + safe-by-default
  trust note
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:42'
labels:
  - m-27
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README v2 exists (ARV-364) but for distribution needs: an install matrix (curl/npm/brew/win), a 60-sec asciinema/gif demo, an explicit safe-by-default note (zond won't break prod on first run), and a one-liner positioning for a stranger. Optionally decide on a GitHub Action wrapper as a CI channel (implement on demand).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README shows all install channels in one place
- [x] #2 A demo artifact (gif/asciinema) is embedded
- [x] #3 safe-by-default trust note is present above the fold
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Install matrix table (curl/brew/npm/win/manual) as its own README section; safe-by-default trust note as a blockquote right under the tagline (above the fold); demo = docs/demo.svg — hand-authored animated SVG terminal (24s CSS loop, real condensed cold-start output), renders natively on GitHub, no vhs/asciinema toolchain needed; verified well-formed + rendered via headless Chrome. Positioning one-liner added to tagline ('API hygiene scanner for small teams'). GitHub Action wrapper: decided to defer, implement on demand (per milestone). Upgrading section gained brew upgrade.
<!-- SECTION:NOTES:END -->
