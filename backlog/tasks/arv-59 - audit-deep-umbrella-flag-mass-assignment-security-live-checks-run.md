---
id: ARV-59
title: 'audit: --deep umbrella flag (mass-assignment + security live + checks run)'
status: To Do
assignee: []
created_date: '2026-05-11 02:45'
updated_date: '2026-05-16 08:43'
labels:
  - audit
  - feedback-loop
  - m-16
  - depth
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: depth-coverage assessment, round 18-19 tester run on resend API.

`zond audit` сейчас включает только `prepare-fixtures → generate → probe static → run → coverage`. Mass-assignment, security и `checks run` (12 depth-checks) — opt-in через `--with-mass-assignment` / `--with-security`. На практике tester-агент после первого прогона (breadth ≈ 95%) не доходит до depth-passes — даёт 8 из 12 depth-checks вообще не запущенными, mass-assignment только в dry-run, security с 11/32 INCONCLUSIVE-BASE без разбора.

Replay assessment (resend): breadth 95%, depth 55%. С `--deep` потенциально 75% за +7 мин runtime.

Предложение:
- Добавить флаг `--with-checks` — отдельная stage в audit pipeline, прогоняет `zond checks run --api <name>` (без `--check` фильтра — все 12 чеков), результаты пишутся в один runs.id (через session).
- Добавить флаг `--deep` — алиас `--with-mass-assignment --with-security --with-checks`. Без флага поведение не меняется (back-compat).
- HTML-отчёт (`audit-report.html`) расширить блоком "Depth checks summary" с findings по severity.
- Coverage union в финальной stage собирает все runs одного session_id — включая checks-run row.

Reference: feedback-18, F3/F4 (UX-инициаторы); existing tasks ARV-3 (ignored_auth/use_after_free implementation), ARV-26 (schema-conformance), ARV-33 (mass-assignment auto-env), ARV-52 (mass-assignment Probe contract).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг --with-checks добавлен, прогоняет 'zond checks run --api <name>' как отдельную stage
- [ ] #2 Флаг --deep алиасит --with-mass-assignment + --with-security + --with-checks
- [ ] #3 Все stages под одним session_id; coverage --union session собирает все runs
- [ ] #4 audit-report.html расширен Depth-checks summary блоком (findings by severity)
- [ ] #5 --deep без --api дружелюбно фейлится (как и базовый audit)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deferred / low priority (2026-05-16 strategy review).

Rationale: zond.md skill now explicitly repositions audit as smoke+breadth pass; depth (stateful checks, security probes, learn-apply) is the skill's job. --deep umbrella adds opt-in stages that audit can't make smart decisions on:

1. zond checks run --check stateful requires api annotate first (m-20 iron rule: defaults miss API quirks). zond has no LLM; annotate is the skill's job. Hardcoding --with-checks runs stateful on defaults → poor findings.

2. R18 pivot (no evidence → no high severity): security probes need scoping + cleanup feasibility checks the skill orchestrates. Hardcoded --with-security flag duplicates iron-rule logic that's already in zond.md.

3. Growth pressure: today --with-checks, tomorrow --with-learn, next --with-annotate-pre. Each new stage = another flag + dependency chain. Skill = instructions in markdown; audit flags = instructions in Commander-options. Markdown wins.

Not Won't Do (still kept for future re-raise): if zond ever ships an in-binary annotation engine (currently scoped out per memory zond_no_llm_calls), --deep becomes viable. Until then, the right path is: zond audit (smoke) → walk Phase 0–9 in skill (depth).

ARV-65 + ARV-66 (correctness fixes for audit smoke) shipped instead — commits 2026-05-16.
<!-- SECTION:NOTES:END -->
