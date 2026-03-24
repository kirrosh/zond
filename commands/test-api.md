---
description: Set up and run API tests with zond
allowed-tools: [Read, Write, Bash(zond *)]
argument-hint: [spec-path or "run" or "coverage"]
---

User wants to test an API.

If $ARGUMENTS is empty — ask for OpenAPI spec path.
If $ARGUMENTS = "run" — run existing tests.
If $ARGUMENTS = "coverage" — show coverage.
Otherwise treat $ARGUMENTS as spec file path.

Workflow:
1. `zond init --name <name> --spec <spec>` (if no structure exists)
2. `zond describe <spec> --compact --json` (do NOT read spec with Read tool)
3. `zond generate <spec> --output <tests-dir> --json` (do NOT write YAML manually)
4. `zond validate <tests-dir>` then `zond run <tests-dir> --safe --json` (smoke immediately)
5. On failures — `zond db diagnose <run-id> --json`, fix specific files, re-run
6. When user confirms test env — `zond run <tests-dir> --json` (full suite with CRUD)
