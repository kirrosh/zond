---
id: TASK-115
title: 'primary assertion — UI должен показывать ассерт, соответствующий смыслу теста'
status: Done
assignee: []
created_date: '2026-04-30 14:19'
updated_date: '2026-04-30 14:44'
labels:
  - ui
  - reporter
  - runner
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В UI на детали failed-run'а заголовок говорит одно (`GET /contacts/{id} — verify injected id not honoured + unsubscribed not flipped`, класс `definitely bug`), а в блоке Assertions показывается несвязанная ошибка (`expected: "format \"date-time\""`). Пользователь видит «другую ошибку» и теряет доверие к репорту.

Корень: `results.assertions` хранит JSON всех ассертов теста (контрактные + schema-validation + housekeeping), а UI рендерит первый failed. Schema-validation шум (формат date-time, лишний required) затмевает контрактный ассерт, ради которого тест существует.

## Что сделать

1. Generator/runner: при добавлении ассерта в шаг помечать его `kind`:
   - `primary` — контрактный, отражающий цель теста (description-level invariant: «injected id not honoured», «unsubscribed not flipped»).
   - `schema` — валидация ответа по OpenAPI.
   - `auxiliary` — служебные (status range, content-type).
2. Reporter сохраняет `kind` в `results.assertions` JSON. Без миграции БД — поле в существующем JSON.
3. UI на странице run-detail:
   - Сначала `primary` (с ярким бордером), потом `schema`, потом `auxiliary`.
   - Первый показанный failed — обязательно `primary` если он есть; иначе `schema`; иначе `auxiliary`.
   - В свёрнутом виде показывать только `primary`, остальное — под expander «Show 3 schema / 2 auxiliary checks».
4. Failure-class detector тоже должен опираться на `primary` (а не на любой failed assert) при определении `definitely bug`.

## Acceptance

- В новом run'е каждый assert имеет поле `kind`.
- UI показывает primary-ассерт первым, остальные сворачиваются.
- Заголовок теста и показанная ошибка визуально соответствуют друг другу.
- Старые run'ы (без `kind`) рендерятся в legacy-режиме без падений.

## Связанные

- TASK-90 (assertion vocabulary) — `kind` ложится поверх существующего словаря.
<!-- SECTION:DESCRIPTION:END -->
