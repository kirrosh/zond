---
id: ARV-49
title: 'probe: introduce TypeScript Probe interface + boot-time harness validator'
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:55'
labels:
  - m-17
  - probe
  - contract
  - agent-contract
milestone: m-17
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-15 F2 (medium) + ARV-9 AC#6 deferred. probe-семейство (static, mass-assignment, security) добавлялось itterativно — у каждой свой набор флагов и формат вывода. Сейчас mass-assignment не имеет --dry-run, security имеет; security --json пихает markdown в data.digest.stdout, run --report json возвращает structured. Этой задачей вводится TS-интерфейс Probe — каждая registered class обязана имплементить все слоты, иначе boot throws. 'Контракт — это TS-тип, не markdown.'
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 interface Probe { name; description; commonFlags; dryRun(ctx): EndpointPlan[]; run(ctx): ProbeResult; report(format: 'markdown'|'json', results): string|object } в src/core/probe/types.ts
- [x] #2 core/probe/registry.ts валидирует все registered classes на старте — отсутствующий слот → throw at boot с понятным сообщением 'Probe X is missing required method dryRun'
- [x] #3 static, mass-assignment, security — все три рефакторнуты под BaseProbe abstract class
- [x] #4 tests/contracts/probe-interface.test.ts: mock Probe class без dryRun → registry throws; mock с полным contract → boots successfully
- [x] #5 Существующие e2e тесты probe-команд остаются green (zero behavior change на этом этапе)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. interface Probe + abstract BaseProbe class в src/core/probe/types.ts. CommonFlags = { api, tag, include, exclude, dryRun, listTags, json, output, report }.\n2. registry.ts собирает Probe[] и валидирует на import-time.\n3. Рефакторинг: src/cli/commands/probe-static.ts, probe-mass-assignment.ts, probe-security.ts получают thin wrapper, основная логика — в core/probe/<class>/probe-class.ts.\n4. Behavior change остаётся zero — это структурный refactor; logic-changes идут в ARV-50/51/52.
<!-- SECTION:PLAN:END -->
