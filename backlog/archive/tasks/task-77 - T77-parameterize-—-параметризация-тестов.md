---
id: TASK-77
title: 'T77: parameterize — параметризация тестов'
status: Done
assignee: []
created_date: '2026-04-29 08:40'
updated_date: '2026-04-29 09:20'
labels:
  - feature
  - runner
  - ergonomics
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Чтобы проверить «list-shape должен быть {object, data, has_more} на 13 эндпоинтах», пользователь скопипастил тест 13 раз. Параметризации нет — приходится либо генератор писать самому, либо терпеть копипасту.

## Что сделать

```yaml
parameterize:
  endpoint: [/emails, /domains, /webhooks, /broadcasts, /contacts]
tests:
  - name: "list shape on {{endpoint}}"
    GET: "{{endpoint}}"
    expect: { status: 200, body: { object: { equals: 'list' } } }
```

Расширяется в 5 тестов с разными {{endpoint}}.

Семантика:
- На уровне сьюта — внешний loop.
- Несколько ключей → cross-product.
- Captures isolated per-iteration.
- Имя теста / шага — интерполируется чтобы reporter различал.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parameterize: { endpoint: [/a, /b, /c] } на уровне сьюта или test'а — разворачивает в N тестов
- [x] #2 Имя теста интерполируется: 'list shape on {{endpoint}}'
- [x] #3 Несколько параметров → cross-product
- [x] #4 Документация в ZOND.md
<!-- AC:END -->
