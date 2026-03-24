---
description: Run safe GET-only smoke tests
allowed-tools: [Bash(zond *)]
---

!`zond run tests/ --safe --tag smoke --json 2>/dev/null || echo "No tests found"`

If no tests found, tell the user to run /test-api first.
Otherwise, summarize the results from the JSON output above.
