---
id: ARV-122
title: >-
  spec: layered spec model — SpecLayer interface + composeSpec() + provenance
  map
status: Done
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 15:12'
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
- [x] #1 src/core/spec/layers.ts реализует SpecLayer + composeSpec
- [x] #2 ARV-111 extension-mechanism (.api-resources.local.yaml) реализован через SpecLayer
- [x] #3 refresh-api использует composeSpec — user-extension не теряются
- [x] #4 ProvenanceMap доступна как внутренний API; CLI surface не обязателен в этом task'е
- [x] #5 tests/core/spec/layers.test.ts покрывает merge policies + precedence
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/spec/layers.ts:
- SpecLayer<T> interface: id, path, precedence, scope, mergePolicy ("override" | "preserve" | "append"), async load().
- composeSpec(layers, keyFn) → ComposedSpec<T> = { entries, provenance: Map<key, layerId> }.
- Stable sort by precedence, duplicate-id guard, sequential await preserves provenance determinism.

Wired into existing two-source merge:
- src/cli/commands/discover.ts: buildResourceLayers() declares upstream (precedence 10, .api-resources.yaml) + extension (precedence 20, .api-resources.local.yaml), both mergePolicy "override".
- New composeResourceMap() exposes ComposedSpec<ResourceYaml> for callers that need provenance.
- readResourceMap() rewritten to route through composeSpec; legacy return-shape (ApiResourceMapYaml | null) preserved by re-checking upstream existence (matches old null-on-missing contract).
- RESOURCE_LAYER_UPSTREAM / RESOURCE_LAYER_EXTENSION exported as stable string ids for downstream code (doctor / future catalog --provenance).

refresh-api unchanged — it only writes upstream artifacts, never touches .local.yaml; the regression test in tests/cli/resource-extensions.test.ts (ARV-122 case) simulates refresh by rewriting upstream and asserts the extension layer + its provenance survive in the composed map.

Tests:
- tests/core/spec/layers.test.ts (7 cases): override / preserve / append; precedence ordering; async loader determinism; duplicate-id guard; empty-input edge.
- tests/cli/resource-extensions.test.ts: +1 ARV-122 regression covering refresh-api preservation.

Verified: 517 tests across contracts + cli suites pass; typecheck clean; binary rebuilt and installed.

CLI surface (--provenance, doctor) intentionally deferred per task body — landed only the internal API.
<!-- SECTION:NOTES:END -->
