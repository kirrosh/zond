---
id: TASK-90
title: document assertion vocabulary (equals/exists/type/not_equals/...)
status: To Do
assignee: []
created_date: '2026-04-29 11:39'
labels:
  - docs
  - dx
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В round-2 несколько раз приходилось гадать, какие правила assertion-ов поддерживает zond — `equals`, `exists`, `type`, `contains`, `matches`, `gt`/`lt`, `not_equals`, `capture`. Они есть в `core/runner/assertions.ts`, но в `ZOND.md` упоминаются вскользь (раздел Assertions, без полного перечня и примеров).

Для авторов YAML-тестов и для AI-агентов это блокер: они придумывают rules, которых нет, либо боятся использовать рабочие.

## Что сделать

- В `ZOND.md` (раздел Assertions, строка ~233) развернуть таблицу `rule | example | semantics | поддержка для headers/body/status`.
- Перечислить все правила из `core/runner/assertions.ts` (синхронизировать с реализацией, чтобы не разойтись).
- Добавить разделы про:
  - вложенные пути (`user.profile.email`);
  - `null` / `exists`;
  - `capture` (как извлекать значения для chained suites);
  - `type: array | object | number | string | boolean | null`.
- Включить пример полного `expect:` блока с несколькими правилами.
- В `init/templates/skills/zond.md` добавить ссылку на этот раздел из Phase 2 (Generate).

## Acceptance

- В `ZOND.md` есть полная таблица rules (актуальная относительно `core/runner/assertions.ts`).
- Skill-шаблон ссылается на этот раздел.
- Минимум один e2e пример с `not_equals` / `capture` / nested path.
<!-- SECTION:DESCRIPTION:END -->
