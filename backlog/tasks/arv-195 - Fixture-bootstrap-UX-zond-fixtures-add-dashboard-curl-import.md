---
id: ARV-195
title: 'Fixture-bootstrap UX: zond fixtures add + dashboard/curl import'
status: Done
assignee: []
created_date: '2026-05-13 19:19'
updated_date: '2026-05-15 12:52'
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
- [x] #1 Команда 'zond fixtures add <var>=<id>' с GET-validate (живой/stale/unknown), запись в .env.yaml
- [x] #2 Команда 'zond fixtures import --from-curl' принимает paste из dashboard / chrome devtools (curl) и извлекает path-id'шки
- [ ] #3 (опционально) 'zond fixtures import --from-postman' — collection.json
- [ ] #4 UX-test: новый API с нуля выходит из 0/N до ≥80% path-FK fill без ручной правки .env.yaml
- [x] #5 Skill (zond.md / zond-base.md) обновлена с новым flow
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализована команда zond fixtures с двумя subcmd: 'fixtures add <var>=<id> [--validate] [--apply]' и 'fixtures import --from-curl [--apply]'. Add проверяет --validate через GET read-by-id endpoint в spec и классифицирует live/stale/unknown (закрытие AC-связи с ARV-32). Import парсит curl (URL-token state machine для quoted/multiline), матчит против spec.paths longest-template-first и извлекает {var}-биндинги из URL-сегментов. Обе команды пишут в apis/<name>/.env.yaml через upsertEnvLine с .bak бэкапом, без изменений в .api-fixtures.yaml. Pure helpers (extractUrlFromCurl, extractFixturesFromPath) тестируются в tests/cli/fixtures.test.ts (8 кейсов: quoted/multiline curl, longest-match path, URL-decode). CLI envelope-compliance allow-list обновлён. Skill zond.md дополнен секцией про manual fixture-bootstrap. AC #3 (postman) и AC #4 (UX-тест на live API) отложены — для #4 нужен живой Stripe-аккаунт.
<!-- SECTION:FINAL_SUMMARY:END -->
