---
id: ARV-51
title: >-
  probe: --report json emits structured per-endpoint findings (no markdown blobs
  in envelope)
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:55'
labels:
  - m-17
  - probe
  - json-envelope
  - agent-contract
milestone: m-17
dependencies:
  - ARV-49
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-15 F3+F4 (low). probe security --json упаковывает markdown digest в data.digest.stdout как одну raw-строку — JSON envelope нечитабельный для скриптов; декларированный контракт '--report json — test-run report (structured), <cmd> --json — query-result envelope' (zond run --help) probe-семейство не соблюдает. Без structured probe-output агенты не могут автоматизировать post-run триаж — главный agent usecase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond probe security --report json возвращает endpoints[{path, method, classes_run, findings: [{class, severity, evidence: {request_signature, response_signature, baseline_diff}}], status: 'ok'|'high'|'low'|'inconclusive'}]
- [x] #2 data.digest.stdout НЕ существует ни в одном envelope probe-команды
- [x] #3 Markdown digest доступен через --report markdown ИЛИ --output <file> (как сейчас), но не в --json envelope
- [x] #4 Schema published в docs/json-schema/probe-security.schema.json (и mass-assignment.schema.json после ARV-52)
- [x] #5 F4-15 fixture-test: zond run --report json и zond probe security --report json возвращают одинаковую структурную глубину (endpoints[].findings[])
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. report(format, results) в Probe interface принимает 'markdown' | 'json' | 'sarif' (sarif на потом).\n2. Существующий markdown-вывод оборачивается в report('markdown', results).\n3. Новый report('json', results) собирает structured per-endpoint object из internal ProbeResult.\n4. Удалить data.digest.stdout хак из envelope-builder'а — это была обходная конструкция, делаем sunset.
<!-- SECTION:PLAN:END -->
