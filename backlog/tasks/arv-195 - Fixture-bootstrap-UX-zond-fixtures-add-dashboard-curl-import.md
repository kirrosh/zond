---
id: ARV-195
title: 'Fixture-bootstrap UX: zond fixtures add + dashboard/curl import'
status: To Do
assignee: []
created_date: '2026-05-13 19:19'
labels:
  - m-21
  - fixtures
  - ux
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
25/69 path-FK на Stripe — потолок prepare-fixtures --seed. Нужен явный путь ручного bootstrap'а. ARV-32 (validate hardcoded ids с GET) — часть этой задачи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда 'zond fixtures add <var>=<id>' с GET-validate (живой/stale/unknown), запись в .env.yaml
- [ ] #2 Команда 'zond fixtures import --from-curl' принимает paste из dashboard / chrome devtools (curl) и извлекает path-id'шки
- [ ] #3 (опционально) 'zond fixtures import --from-postman' — collection.json
- [ ] #4 UX-test: новый API с нуля выходит из 0/N до ≥80% path-FK fill без ручной правки .env.yaml
- [ ] #5 Skill (zond.md / zond-base.md) обновлена с новым flow
<!-- AC:END -->
