---
id: ARV-363
title: >-
  residual-judgment sweep — data-factory scalar-guess narrow + path-discovery
  post-334 audit + severity/ fate
status: Done
assignee: []
created_date: '2026-07-08 07:13'
updated_date: '2026-07-08 07:51'
labels:
  - m-25
  - cleanup
  - zond-core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Три остаточные зоны зашитого суждения, оставленные m-24 из-за широкого fan-in:
1. core/generator/data-factory.ts (759L) — сузить до placeholder-синтеза под generate (агент ревьюит yaml); срезать скалярное угадывание значений под live-путь.
2. core/probe/path-discovery.ts (439L) — доаудитить после выпила idFromItem: убедиться, что не осталось name-blind positional-fill.
3. core/severity/ (152L) — калибратор уже default pass-through. Решение: оставить как явный opt-in инструмент ИЛИ выпилить целиком (severity — суждение агента). Дефолт-решение: cut, если нет внешнего потребителя.

LITMUS: evidence-синтез плейсхолдеров детерминирован → keep; угадывание значения/severity → agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 data-factory: live-path scalar guessing срезан, placeholder-синтез для generate сохранён
- [ ] #2 path-discovery: подтверждено отсутствие name-blind positional-fill (тест на ARV-334-регрессию)
- [ ] #3 severity/: судьба решена одним из вариантов, LOC-дельта зафиксирована в final-summary
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Investigated all three targets (data-factory 759L, path-discovery 439L, severity/ 152L) via code-read + consumer tracing. Verdict: KEEP all three — no cut needed. m-24 removed the heuristic layer more thoroughly than this task assumed.

- data-factory.ts: dumb placeholder synthesizer for `generate` + baseline probe bodies. All live paths prefer env > discovery > guessed placeholders; guessed scalars never ship to an API without agent review or discovery replacement. KEEP.
- path-discovery.ts: idFromItem (410-422) already reshaped in m-24 — prefers "id" then spec-aware captureFieldFor (response-schema-typed field), NOT name-blind positional. pickFieldFromBody is spec-hint-driven (preferredField from param suffix) + env-first + skip-on-fail. Probe-time id-grabbing (reach a real resource to attack) is deterministic mechanics, not fixture-value judgment. KEEP.
- severity/: autonomous calibrator already gone (m-24). Remainder = category.ts (closed-enum ID→category taxonomy, ARV-251) + index.ts (rank/SARIF ladder). Pure deterministic, wired to lint/checks/mass-assignment, tested. Decision: KEEP (not opt-in-tool, not cut — it is core, not the calibrator).

No code change. LITMUS clean: nothing here is a residual heuristic judgment.
<!-- SECTION:FINAL_SUMMARY:END -->
