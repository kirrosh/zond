---
id: TASK-112
title: 'test YAML: raw-body / text-body field for content-type probes'
status: To Do
assignee: []
created_date: '2026-04-30 13:55'
labels:
  - test-yaml
  - parser
  - probe
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Phase 5.3 (Robustness probes) в скилле требует слать **строковые** тела — truncated JSON, trailing comma, unquoted keys, BOM-prefixed payload, deeply-nested string и т.п. — для проверки парсера до schema-валидации. Сейчас `TestStep` поддерживает только `json` (структурированный), `form`, `multipart`. Сериализация всегда через `JSON.stringify` или form-encode, поэтому невалидный JSON выслать нельзя.

Прогон на Resend (19 content-type/malformed векторов) показал, что 6 из 19 кейсов невыразимы в текущем YAML.

## Что сделать

Добавить опциональное поле `raw_body: string` (или `text_body`) в `TestStep`:
- Несовместимо с `json` / `form` / `multipart` (валидатор должен ругаться на коллизию).
- При наличии — `send-request` отправляет байты как есть, `Content-Type` берётся из `headers`.
- Документировать в `ZOND.md` и в YAML schema.

## Файлы

- `src/core/parser/types.ts` — поле в `TestStep`.
- `src/core/parser/yaml-parser.ts` — парс + валидация коллизий.
- `src/core/runner/send-request.ts` — отправка.
- `src/core/lint/walker.ts` — lint-предупреждение про коллизии.
- `tests/parser/yaml-parser.test.ts` + новый integration test.
- `ZOND.md` — документация поля.

## Связано

- TASK-111 — Phase 5.3 в скилле, ссылается сюда.
- Live-session digest (Resend probe-content-type-malformed.yaml) — 19 векторов.
<!-- SECTION:DESCRIPTION:END -->
