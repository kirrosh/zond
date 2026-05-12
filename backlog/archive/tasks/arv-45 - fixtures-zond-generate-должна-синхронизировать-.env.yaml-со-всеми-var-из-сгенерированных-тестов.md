---
id: ARV-45
title: >-
  fixtures: zond generate должна синхронизировать .env.yaml со всеми {{var}} из
  сгенерированных тестов
status: To Do
assignee: []
created_date: '2026-05-10 18:38'
labels:
  - m-17
  - fixtures
  - env-yaml
  - agent-contract
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13 F2 (medium). После `zond add api` / `zond generate` тесты ссылаются на 18 переменных, но `.env.yaml` содержит только 13. Тесты, использующие `{{template_id}}`, безусловно падают на стадии 'fixture is empty', и сообщение не уточняет, что переменной вообще нет в env. Для агента это значит: один прогон → 5 неочевидных skip'ов без понятной причины. Эта задача делает .env.yaml единственным источником правды о списке переменных. Generate расширяет список, не заполняет значения.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После `zond generate --api X` все {{var}} из tests/*.yaml присутствуют в apis/X/.env.yaml как ключи (значение пустая строка)
- [ ] #2 Каждый дописанный ключ помечен комментарием '# added by generate from tests/<file>:<line>' (видно происхождение)
- [ ] #3 Повторный `zond generate` идемпотентен — не дублирует существующие ключи, не перетирает заполненные значения
- [ ] #4 Существующие пользовательские комментарии и порядок ключей в .env.yaml сохраняются
- [ ] #5 Regression fixture-test: resend spec → generate → .env.yaml содержит broadcast_id, contact_property_id, event_id, template_id, topic_id (5 ключей из feedback-13 F2)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Util src/core/generator/extract-vars.ts: extractTemplateVars(suites) → string[] (regex {{[a-z_][a-z0-9_]*}} с дедупликацией).\n2. В src/cli/commands/generate.ts после записи suites: загрузить .env.yaml через yaml lib с preserveComments, мердж keys, write обратно.\n3. Не трогать существующие values; новые keys в конце с inline-комментом про источник.\n4. Тест в tests/cli/generate-env-sync.test.ts: 3 cases (новый api, существующий env, идемпотентность).
<!-- SECTION:PLAN:END -->
