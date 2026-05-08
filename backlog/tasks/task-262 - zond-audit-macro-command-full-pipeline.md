---
id: TASK-262
title: 'zond audit --api X: macro-команда для полного pipeline (bootstrap→generate→probes→coverage→report)'
status: Done
assignee: []
created_date: '2026-05-08 15:00'
labels:
  - feedback-loop
  - cli
  - workflow
  - high-leverage
dependencies:
  - TASK-261
  - TASK-255
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "Workflow-level" #6.

Сейчас полный аудит API — 8-10 ручных команд:
```
zond bootstrap --api X
zond discover --api X
zond generate --api X --tag ...
zond probe-validation --api X
zond probe-methods --api X
zond session start --label audit
zond run apis/X/tests
zond run apis/X/probes
zond session end
zond coverage --api X --union session
zond report html --out audit-report.html
```

Цель: `zond audit --api X` оборачивает весь pipeline в одну команду:
1. (опционально) `bootstrap` если `.env.yaml` пустой и `--seed` или `--auto-bootstrap`;
2. `discover` + `generate` (smoke + crud + по умолчанию все теги);
3. `probe-validation` + `probe-methods` (опционально `--with-mass-assignment` / `--with-security`);
4. session-wrapped `run` для tests и probes;
5. union coverage (зависит от TASK-255);
6. HTML-репорт `audit-report.html` с сводкой 5xx, security HIGH, coverage по тегам, top failures.

Это «ralph-loop без ralph» — fix-tester loop делает примерно то же руками.

Impact: full audit = одна команда вместо setup-ralph-loop. Снижает порог входа с 3-4 часов до 5 минут на новый API.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `zond audit --api X [--seed] [--with-mass-assignment] [--with-security] [--out audit-report.html]` существует.
- [x] Stages пропускаются если артефакты уже свежие (mtime: tests/ newer than spec.json → skip generate; `--force` отключает).
- [x] Каждая stage печатает `==> Stage N/M: <name>` для visibility.
- [x] Failure на любой stage НЕ останавливает report; в HTML-таблице видна строка `failed` с exit_code; финальный exit 1 если есть хоть одна failed stage.
- [ ] Verify: `zond audit --api sentry --seed` на чистом workspace — integration-тест за рамками unit-теста, проверяется руками.
- [x] `--dry-run` показывает план без выполнения.
<!-- SECTION:ACCEPTANCE:END -->
