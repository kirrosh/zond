---
id: TASK-48
title: 'T48: HTTP method completeness sweep — 405 probe'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - bug-hunting
  - generator
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Spec заявляет `GET /audiences/{id}` и `DELETE /audiences/{id}`, но не PATCH. Если PATCH не возвращает 405 (а, скажем, 500 или 404), это потенциальный баг или забытая логика.

## Что сделать

В `zond generate` (или новый `--negative-methods` флаг): для каждого path сгенерировать negative-method probe-сьют:

- Для каждого path определить методы из spec.
- Для **отсутствующих** методов (из {GET, POST, PUT, PATCH, DELETE}) сгенерировать step с `expect: status: [405, 404]`.
- Тэг `[smoke, negative-method]`.

Пример:
```yaml
name: orders-method-completeness
tags: [smoke, negative-method]
tests:
  - name: PATCH /orders → 405
    PATCH: /orders
    expect: { status: [405, 404] }
```

Вариант B: отдельная команда `zond probe-methods <spec>` без YAML-генерации (просто прогон + отчёт).

## Acceptance

- На spec с 5 path × 3 method coverage генерирует ~10 negative-method тестов.
- Запуск даёт fail если endpoint возвращает 200/500 на неподдерживаемый метод.
- Документация.
<!-- SECTION:DESCRIPTION:END -->
