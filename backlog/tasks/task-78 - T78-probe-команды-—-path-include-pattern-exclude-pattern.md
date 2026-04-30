---
id: TASK-78
title: 'T78: probe-команды — --path / --include-pattern / --exclude-pattern'
status: To Do
assignee: []
created_date: '2026-04-29 08:40'
labels:
  - bug-hunting
  - cli
  - ergonomics
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond probe-validation <spec>` сейчас генерит для всех эндпоинтов. На больших API (Stripe, Shopify) это сотни-тысячи проб. Хочется точечно работать с одним ресурсом без загрузки всего и фильтрации тэгами потом.

## Что сделать

Унифицированно для всех probe-команд (T49 Done, T48 Done, T57-T67):
- `--path <p>` — точное совпадение path
- `--include-pattern <glob>` — glob фильтр
- `--exclude-pattern <glob>` — обратный
- Tag-фильтр на сгенерённых сьютах оставить, но это уже скоринг после генерации.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe-validation/probe-methods/probe-* поддерживают --path /webhooks (точечный scope)
- [ ] #2 --include-pattern '/audiences/**' (glob по path)
- [ ] #3 --exclude-pattern для исключения
- [ ] #4 Документация в ZOND.md
<!-- AC:END -->
