---
id: ARV-386
title: npm channel works for node-only users (bin decoupled from bun)
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:12'
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
- [x] #1 npm i -g @kirrosh/zond && zond --version runs on a machine WITHOUT bun
- [x] #2 postinstall picks the correct platform artifact and verifies checksum
- [x] #3 package.json files/bin reflect the new layout; no src/ TS execution at runtime
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Thin node launcher bin/zond.mjs + scripts/npm/postinstall.mjs (fetch raw binary from GH release by pkg version, sha256 verify vs checksums.txt, ZOND_DOWNLOAD_BASE override for E2E). release.yml attaches raw binaries + checksums.txt. Runtime deps moved to devDependencies, engines node>=20, npm publish --ignore-scripts. Verified: npm pack = 6 files no src/; local fake-release npm i -g → zond --version OK; 2449 tests pass. Real clean-machine gate = ARV-392 after next release.
<!-- SECTION:NOTES:END -->
