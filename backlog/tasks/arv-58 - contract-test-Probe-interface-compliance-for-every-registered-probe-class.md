---
id: ARV-58
title: 'contract-test: Probe interface compliance for every registered probe class'
status: To Do
assignee: []
created_date: '2026-05-10 18:45'
labels:
  - m-17
  - contract-test
  - probe
  - ci
  - agent-contract
dependencies:
  - ARV-49
  - ARV-50
  - ARV-51
  - ARV-52
priority: medium
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После ARV-49 (Probe interface) нужен compile-time + runtime контракт-тест. tests/contracts/probe-interface.test.ts для каждой registered probe class запускает: --list-tags --json (shape ok), --dry-run --json (shape ok, planned/skipped buckets, severity отсутствует), --help (содержит обязательные флаги). F1-15/F2-15/F3-15 не возвращаются как регрессии.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/contracts/probe-interface.test.ts table-driven: для каждого entry в core/probe/registry.ts → 4 sub-tests
- [ ] #2 Sub-test 1: --help содержит все обязательные флаги (--dry-run, --list-tags, --api, --tag, --include, --exclude, --json, --report, --output)
- [ ] #3 Sub-test 2: --list-tags --json возвращает {tags: string[]} (envelope-compliant)
- [ ] #4 Sub-test 3: --dry-run --json на mock spec (3 endpoints) возвращает data.endpoints[] с planned/skipped enum (закрывает F1-15 fixture)
- [ ] #5 Sub-test 4: --report json (real run, mocked HTTP) возвращает endpoints[].findings[] structured (закрывает F3-15 fixture)
- [ ] #6 Adding new Probe class without matching contract → test fail at boot
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. tests/contracts/probe-interface.test.ts с table-driven enumeration через registry.\n2. Mock spec fixture: petstore subset с 3 endpoints (1 GET, 2 POST с body).\n3. nock для HTTP mocking.\n4. Сравнение --help output с requiredFlags list через regex.
<!-- SECTION:PLAN:END -->
