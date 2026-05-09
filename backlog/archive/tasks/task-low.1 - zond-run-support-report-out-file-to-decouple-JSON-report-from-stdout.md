---
id: TASK-LOW.1
title: 'zond run: support --report-out <file> to decouple JSON report from stdout'
status: Done
assignee: []
created_date: '2026-04-28 09:09'
updated_date: '2026-04-28 09:24'
labels:
  - bug-hunting
  - from-iteration-4
dependencies: []
parent_task_id: TASK-LOW
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: APPLY runbook tells cron to do 'bun --cwd ~/Projects/zond run zond -- run … --report json > results.json'. Under that exact invocation, the captured file contains bun's own 'bun run --help' text, not zond's JSON report (reproducible from cron env). Workaround: 'cd ~/Projects/zond && bun run zond -- run … > results.json' works.

Observation: Even when bun's wrapper behaves, 'bun run' prepends a '$ bun run …' banner line to stdout, so the first line of the captured 'JSON' is non-JSON and breaks downstream parsers (json.load fails with 'Expecting value: line 1 column 1').

Suggested fix: Add 'zond run --report-out <path>' that writes the JSON report directly via fs, bypassing stdout. Keep '--report json' (stdout) for ad-hoc use. Also consider --quiet to suppress the bun banner when run via 'bun run' wrappers.
<!-- SECTION:DESCRIPTION:END -->
