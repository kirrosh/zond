---
description: Set up and run API tests with zond
allowed-tools: [Read, Write, Bash(zond *)]
argument-hint: [spec-path or "run" or "coverage"]
---

User wants to test an API.

If $ARGUMENTS is empty — ask for OpenAPI spec path.
If $ARGUMENTS = "run" — run existing tests (ask coverage level before running, skip steps 1-3).
If $ARGUMENTS = "coverage" — show coverage (no coverage level question needed).
Otherwise treat $ARGUMENTS as spec file path.

Workflow:
1. `zond init --name <name> --spec <spec>` (if no structure exists)
2. `zond describe <spec> --compact --json` (do NOT read spec with Read tool)
3. `zond generate <spec> --output <tests-dir> --json` (do NOT write YAML manually)
3.5. Check prior runs (`zond db runs`), filter already-completed levels, then **AskUserQuestion** with remaining options — see SKILL.md Step 3.5
4. `zond validate <tests-dir>` then `zond run <tests-dir> --safe --json` (smoke immediately)
5. On failures — `zond db diagnose <run-id> --json`, fix specific files, re-run
   - If "Safe only" → STOP after smoke passes, show next-step commands
6. `zond run <tests-dir> --json` (full suite with CRUD)
   - If "CRUD" → STOP after CRUD passes, show next-step commands
7. `zond coverage --spec <spec> --tests <tests-dir> --json` + fill gaps (Maximum only)
