---
id: TASK-36
title: 'T36: Tagless endpoints fallback на per-resource suite'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - generator
milestone: m-1
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Эндпоинт `/audiences` есть в Resend OpenAPI, но `zond generate` его пропускает. Причина: `groupEndpointsByTag` (`src/core/generator/chunker.ts`) требует тегов, а у audiences их нет в spec. Endpoints без тега выпадают.

## Что сделать

В `chunker.ts:groupEndpointsByTag`:

1. Сгруппировать endpoints по тегу как сейчас.
2. Для endpoint'ов **без тегов** — fallback-группировка по первому сегменту path:
   - `/audiences`, `/audiences/{id}` → group "audiences"
   - `/users`, `/users/{id}` → group "users" (если они без тегов в spec)

3. Имя группы slugify'ится в filename.

Это гарантирует, что **все active endpoints из spec попадают в какой-то suite**.

## Acceptance

- Resend OpenAPI: `/audiences` POST/GET/DELETE появляются в `crud-audiences.yaml` (или `smoke-audiences.yaml` без CRUD-группы).
- Тест: spec с tagged + untagged endpoints → оба попадают в suites.
- Coverage до и после: tagless endpoints больше не "uncovered".
<!-- SECTION:DESCRIPTION:END -->
