---
id: ARV-386
title: npm channel works for node-only users (bin decoupled from bun)
status: To Do
assignee: []
created_date: '2026-07-09 12:56'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
bin.zond currently points to src/cli/index.ts (raw TS) → requires bun installed. `npm i -g @kirrosh/zond` fails for node-only users. Make bin a thin launcher with a postinstall that fetches the platform binary from the GH release (esbuild/turbo model), or repoint bin at the compiled binary. Re-scope of the npm slice of old ARV-365.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm i -g @kirrosh/zond && zond --version runs on a machine WITHOUT bun
- [ ] #2 postinstall picks the correct platform artifact and verifies checksum
- [ ] #3 package.json files/bin reflect the new layout; no src/ TS execution at runtime
<!-- AC:END -->
