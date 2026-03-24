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

Follow workflow from skill api-testing:
1. zond init (if no structure)
2. zond describe --compact (understand API)
3. Generate tests (use skill generate-api-tests)
4. zond validate
5. zond run --safe --json
6. On failures — use skill test-diagnosis
