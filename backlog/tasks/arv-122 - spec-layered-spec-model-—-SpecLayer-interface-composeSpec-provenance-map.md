---
id: ARV-122
title: >-
  spec: layered spec model — SpecLayer interface + composeSpec() + provenance
  map
status: To Do
assignee: []
created_date: '2026-05-11 10:13'
labels:
  - m-19
  - refactor
  - blocker-m-18
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§4 refactor-plan, precaution для m-18 (quicktype + mitmproxy patches).

src/core/spec/layers.ts:
- SpecLayer { id, path, precedence, scope, mergePolicy }
- composeSpec(layers[]) -> ComposedSpec + ProvenanceMap (endpoint+field -> layer.id)
- миграция текущих двух источников через interface:
  * upstream = apis/<name>/spec.json
  * user-extension = apis/<name>/.api-resources.local.yaml (ARV-111)
- refresh-api снимает только upstream layer, user-extension остаётся
- готовится подключение quicktype-derived и mitmproxy-derived в m-18

Этот task НЕ добавляет CLI surface (--provenance, doctor-output) — это
делается уже в m-18 параллельно с подключением quicktype-layer'а.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/spec/layers.ts реализует SpecLayer + composeSpec
- [ ] #2 ARV-111 extension-mechanism (.api-resources.local.yaml) реализован через SpecLayer
- [ ] #3 refresh-api использует composeSpec — user-extension не теряются
- [ ] #4 ProvenanceMap доступна как внутренний API; CLI surface не обязателен в этом task'е
- [ ] #5 tests/core/spec/layers.test.ts покрывает merge policies + precedence
<!-- AC:END -->
