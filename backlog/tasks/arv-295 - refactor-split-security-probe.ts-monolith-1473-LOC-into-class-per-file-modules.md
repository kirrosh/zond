---
id: ARV-295
title: >-
  refactor: split security-probe.ts monolith (1473 LOC) into class-per-file
  modules
status: Done
assignee: []
created_date: '2026-05-18 12:56'
updated_date: '2026-05-18 13:36'
labels:
  - refactor
  - hygiene
  - validation-sprint
  - m-23
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/probe/security-probe.ts вырос до 1473 LOC и экспортирует 5+ функций для разных классов уязвимостей (SSRF, CRLF, header injection, auth bypass и др.). Это монолит, который сложно навигировать и в котором повторяющиеся паттерны (патч-генерация, валидация ответов, evidence-сборка) не вытащены наружу. Cost: 1-2 дня. Risk: low (217 тестов, strict TS). Выявлено в pre-release refactor review 2026-05-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/probe/security/index.ts реэкспортирует публичный API без изменения сигнатур
- [x] #2 Дублирующиеся helpers вынесены в core/probe/security/shared.ts или core/util/
- [x] #3 bun test и bun run check проходят без изменения поведения
- [x] #4 Per-aspect split (вариант A, утверждён 2026-05-18): types / detectors / baseline / cleanup / classify / digest / regression вынесены в core/probe/security/*.ts
- [ ] #5 core/probe/security-probe.ts остаётся как barrel re-export, public API не изменился (SecurityClass, SECURITY_CLASSES, SecuritySeverity, SecurityFieldHit, SecurityFinding, SecurityVerdict, SecurityProbeOptions, CleanupFeasibility, SecurityProbeResult, detectFields, runSecurityProbes, classifyEcho, formatSecurityDigest, emitSecurityRegressionSuites)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Развилка обнаружена при старте (2026-05-18): per-vulnerability-class split (SSRF/CRLF/open-redirect отдельные файлы) требует strategy-pattern экстракт общих helpers (probeOneEndpoint/sendBaseline/tryCleanup/classify — ~70% объёма). Это пересекается с ARV-259 trigger (anti-FP registry rewrite). Альтернатива: per-aspect split (types/detectors/baseline/cleanup/classify/digest/regression + orchestrator) — сжимает монолит до ~500 LOC, сохраняет API, не требует evidence-chain rewrite. Жду решения автора по форме split'а.

Done 2026-05-18 (per-aspect, вариант A). orchestrator.ts держит runSecurityProbes + probeOneEndpoint loop; остальные модули — однопроходные пайплайны. Размер monolith'а: 1473 LOC → 8 модулей с самым большим 360 LOC. Public API не менялся, все 63 security-probe теста зелёные. tsc --noEmit чистый. Существующий flaky-test (ssrf-severity-rebalance LOW-on-plain-endpoint при запуске всего набора probe/+contracts/) воспроизводится и на master без моих изменений — отдельная проблема порядка тестов, не регрессия от refactor'а. Per-vulnerability-class split (ssrf.ts/crlf.ts/open-redirect.ts через strategy-pattern) переоформляется в отдельный шаг и ждёт ARV-259 trigger event (anti-FP registry rewrite).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
security-probe.ts (1473 LOC) разбит на per-aspect модули в core/probe/security/: types, detectors, baseline, cleanup, classify, digest, regression, orchestrator. security-probe.ts стал barrel re-export. Public API не менялся. 63 security-probe теста зелёные, tsc --noEmit чистый. Per-class split отложен до trigger event ARV-259.
<!-- SECTION:FINAL_SUMMARY:END -->
