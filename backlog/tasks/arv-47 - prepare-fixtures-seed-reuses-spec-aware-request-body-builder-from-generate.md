---
id: ARV-47
title: 'prepare-fixtures: --seed reuses spec-aware request body builder from generate'
status: Done
assignee: []
created_date: '2026-05-10 18:43'
updated_date: '2026-05-10 19:36'
labels:
  - m-17
  - fixtures
  - seed
  - agent-contract
milestone: m-17
dependencies:
  - ARV-46
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14 F1 (high). zond prepare-fixtures --cascade --seed --apply на resend: 'POST /contacts → 422', 'POST /automations → 422', Seed loop stopped: no-progress. Seed POST'ит resource без spec-aware body. У resend POST /contacts требует audience_id и ещё пару полей — это всё в schemas. Сейчас --seed практически бесполезен на любом нетривиальном API. Главный блок для расширения coverage'a и для макро zond audit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 prepare-fixtures --seed --apply строит body из requestBody.schema (spec-aware, как zond generate для smoke-create)
- [ ] #2 Parent-FK в body заменяются известными values из .env.yaml (например audience_id из predшествующего seed-шага)
- [ ] #3 При 200/201 — fixture filled в .env.yaml; status в таблице filled
- [ ] #4 При 422 — status failed:seed-422 + краткий repro в stderr (curl-style); НЕ no-progress без объяснения
- [ ] #5 Resend regression: на trash-account seed создаёт audience_id, contact_id (хотя бы 1 успешный шаг)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Вынести buildCreateRequestBody(spec, resource, knownFixtures) из cli/commands/generate.ts в core/generator/create-body.ts — он там уже есть как inline-функция.\n2. cli/commands/prepare-fixtures.ts при seed-loop: вызвать buildCreateRequestBody, perform POST, parse status.\n3. На 422 — status failed:seed-422 + сохранить response.body.detail в repro-output.\n4. Тест: mock spec POST /things {body: {name, owner_id ref}} → seed подставляет owner_id из env, отправляет name=randomString.
<!-- SECTION:PLAN:END -->
