---
id: m-23
title: "public-corpus-and-distribution-validation"
---

## Description

Consolidation phase: 8–12 недель валидации **существующего функционала**
zond в рамке decision-8 (hygiene scanner для маленьких команд) через
реальное использование на публичных API + дистрибуцию + content.

**Нулевая ставка**: никаких новых positioning-решений, никакого нового
scope (internal API support, performance probe, race probe — все отложены).
Фокус строго на validation того, что уже shipped.

## Контекст

После m-22 severity matrix overhaul (ARV-250 → ARV-284..288) и обсуждения
очередного pivot'а (full validation tool для dev/QA/DevOps) принято
решение **притормозить positioning-changes до evidence-based signal**.
Текущий decision-8 (hygiene scanner для команд 5–20) был установлен
2026-05-16 после R18 (1184-endpoint GitHub scan); pivot к full validation
рассматривался 2026-05-18 без нового data point — отложен до week-12 gate
m-23 с реальными distribution-метриками.

Competitive landscape (search 2026-05-18): «full validation» сегмент
переполнен (Postman, Bruno, Schemathesis, ReadyAPI, Total Shift Left).
«Hygiene scanner с no-evidence-no-high severity» — uncontested ниша.
Размывать её преждевременно.

## Три параллельных трека

### Трек 1 — Product polish (only что есть)

Закрыть оставшиеся 4 HIGH (ARV-264, ARV-271, ARV-272, ARV-273) + 5–7 LOW
UX papercut'ов. **0 HIGH в open backlog** к концу milestone.

Не делать: internal API support, performance probe, race probe, новые
check classes (кроме уже-HIGH ARV-273).

### Трек 2 — Public corpus (m-23 epic)

5 starter API (Stripe, GitHub, Linear, Resend, OpenAI) в отдельном repo
`zond-public-corpus`. `zond corpus run --safe` daily через GitHub Action.
Per-vendor `.zond/severity.yaml` overlays. Goal: **0 false-HIGH** в
stationary прогоне через 4 цикла.

Задачи: ARV-292 (`--budget` flag), ARV-289 (`zond corpus run`),
ARV-290 (`zond corpus diff`), ARV-291 (corpus repo skeleton).

### Трек 3 — Distribution & content

- ARV-293 — README v2 под decision-8 framing.
- ARV-294 — npm package + brew formula publishing.
- 4 blog posts (positioning, Stripe showcase, calibration story,
  retrospective). Один Show HN / r/programming submission после
  blog #2.

## Метрики успеха (falsifiable, week-12 gate)

| Метрика | Target |
|---|---|
| GitHub stars (main repo) | +100 |
| npm weekly downloads | 100 |
| External GitHub issues opened | 5 |
| Corpus repo PRs from external | 2 |
| External blog mentions / cites | 3 |
| Vendor fixes attributed to zond | ≥ 1 |
| False-HIGH в corpus stationary | 0 |
| Open HIGH backlog | 0 |

**Failure signal** (если видим к week 12 → evidence-based pivot decision):
< 30 stars / < 50 downloads / 0 external PRs / 0 cites.

**Success signal** (если видим → продолжаем decision-8 в m-24):
≥ 50 stars / ≥ 100 downloads / ≥ 1 external corpus PR / ≥ 1 vendor fix.

## Week-by-week checkpoints

- **Week 2**: m-23 tasks filed, ARV-264/273 closed, corpus repo private.
- **Week 4**: Phase A+B complete, README v2 live, npm publish, blog #1.
  **Gate #1**: traction baseline зафиксировать.
- **Week 6**: Phase C+D (diff + overlays), blog #2 + community submission.
  **Gate #2**: stars +20? Если 0 — debug messaging, не pivot.
- **Week 8**: 0 HIGH backlog, blog #3, external feedback triage active.
  **Gate #3** mid-point: metrics 60%+ targets — план работает.
- **Week 12**: full retrospective. **DECISION GATE**:
  - (A) Continue decision-8 → m-24 в той же рамке.
  - (B) Evidence-based pivot → decision-9 на основе real signal.
  - (C) Stop & rethink distribution strategy.

## Out of scope (зафиксировано)

- Internal API support (mTLS, SSO, private VPC).
- Performance / race / BOLA / OOB probes.
- Hosted UI / dashboard / SaaS.
- Pivot positioning до week-12 gate.
- Архитектурные рефакторинги.
- Новые epic'и кроме m-23.

## Related

- decision-8 (2026-05-16) — positioning framing валидируется в этом milestone.
- m-22 — severity matrix overhaul завершён, baseline для corpus.
- memory `feedback_consolidation_phase_2026_05` — обещание не pivot'ить до gate.
