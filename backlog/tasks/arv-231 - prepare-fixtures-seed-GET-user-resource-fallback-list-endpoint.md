---
id: ARV-231
title: 'prepare-fixtures --seed: GET /user/<resource> fallback list endpoint'
status: To Do
assignee: []
created_date: '2026-05-14 10:41'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F2, class missing-feature
Repro: zond prepare-fixtures --api github --apply --cascade --seed
Expected: owner/repo (и др. owner-scoped resources) должны заполняться через GET /user/<resource> когда POST требует extra scope (403). Стандарт harvest'а в других skills.
Actual: оба остаются failed:miss-empty-no-seed-owner — fallback на GET /user/repos не вшит в seed-loop. discovered username/user_id работает для других resources.
Effect: 80%+ generate-test'ов идут под skip-no-create на public-API github, coverage стопорится на 3%.
Solution sketch: per-resource fallback_list endpoint в .api-resources.yaml ИЛИ эвристика «если есть /user/<resource> GET — попробовать его».
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
