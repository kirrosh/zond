---
id: TASK-161
title: 'probe-security --emit-tests: не создавать пустые директории'
status: Done
assignee: []
created_date: '2026-05-06 06:39'
updated_date: '2026-05-07'
labels:
  - lifecycle
  - probe-security
  - emit
  - bug
dependencies: []
milestone: m-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P5.

`zond probe-security … --emit-tests dir/` создаёт `dir/` даже если
эмитить нечего (нет 2xx-finding'ов). После 4 запусков остались
4 пустых `security-emit-v*/`.

## Что сделать

1. Если эмитить нечего — **не создавать каталог**. Stdout-сообщение:
   `No 2xx findings to emit. Directory not created.`
2. Альтернатива: положить EMPTY-файл `_no-findings.md` с пояснением
   и timestamp'ом.

Рекомендация: вариант 1 (не создавать) — меньше шума, идиоматично.

## Acceptance Criteria

- [ ] `--emit-tests dir/` без 2xx-finding'ов: каталог `dir/` не создаётся.
- [ ] Stdout сообщает «no findings, nothing emitted».
- [ ] Если каталог уже существовал — он не трогается, не очищается.
<!-- SECTION:DESCRIPTION:END -->
