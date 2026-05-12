---
id: ARV-168
title: >-
  docs / skill: 'probe static vs checks run vs probe security' — когда что
  запускать (workflow table)
status: To Do
assignee: []
created_date: '2026-05-12 12:46'
labels:
  - feedback-loop
  - skill-drift
  - m-16
  - docs
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09 final evaluation §1 'Слабые стороны'.

Observation: probe static --use-synthetic-parents (random-data probes per endpoint) и checks run --phase coverage (rule-based contract checks) пересекаются по 'validation gaps' — но в разных форматах, разных каталогах, разных severity. User должен запустить оба, чтобы получить полный signal — это discovery-gap.

Expected: skill / docs содержит decision table:
| Цель | Команда | Что найдёт уникального |
|---|---|---|
| Spec drift / contract violations | checks run --phase coverage | HIGH findings: drift, missing fields, type mismatches |
| Input validation gaps (boundary, null, oversize) | probe static --use-synthetic-parents | missing-validation на edge inputs |
| Authn/Authz/Injection vectors | probe security ssrf,crlf,open-redirect,prompt-injection | confirmed/INCONCLUSIVE attack surface |
| Mass-assignment / privilege escalation | probe mass-assignment | extra-field acceptance, RBAC bypass |
| Schema conformance of actual responses | run --validate-schema (+ tests/) | per-step contract diff |

И recommended order для audit-сессии: spec lint → checks --phase coverage → probe static → probe mass-assignment → probe security → run + --learn.

Где: src/cli/commands/init/templates/skills/zond.md, или новый zond-max-coverage если ARV-160 адаптируется.

Effect: устраняет 'tester-mindset gap' R02-R04 (тестер пропускал probe-static, audit, db diagnose 4 раунда подряд).
<!-- SECTION:DESCRIPTION:END -->
